/**
 * Gemini function declarations accept an OpenAPI-style Schema subset, not full
 * JSON Schema. Unknown keys such as `additionalProperties` or `$schema` make the
 * whole generateContent request fail with 400 INVALID_ARGUMENT, and an OBJECT
 * with an empty `properties` map is rejected as well. Anthropic tool schemas are
 * written in JSON Schema, so convert them before they go to Gemini.
 */

/** Schema fields the Gemini API documents for function parameters. */
const GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'title',
  'description',
  'nullable',
  'enum',
  'maxItems',
  'minItems',
  'properties',
  'required',
  'minProperties',
  'maxProperties',
  'minLength',
  'maxLength',
  'pattern',
  'example',
  'anyOf',
  'propertyOrdering',
  'default',
  'items',
  'minimum',
  'maximum',
]);

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEmptyObjectSchema(schema: JsonObject): boolean {
  const type = typeof schema.type === 'string' ? schema.type.toLowerCase() : '';
  return type === 'object' && (!isObject(schema.properties) || Object.keys(schema.properties).length === 0);
}

/** Recursively keep only the Schema fields Gemini accepts. */
export function sanitizeGeminiSchema(schema: unknown): JsonObject {
  if (!isObject(schema)) return {};
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    if (key === 'properties') {
      if (!isObject(value)) continue;
      const properties: JsonObject = {};
      for (const [name, child] of Object.entries(value)) properties[name] = sanitizeGeminiSchema(child);
      out.properties = properties;
    } else if (key === 'items') {
      if (isObject(value)) out.items = sanitizeGeminiSchema(value);
    } else if (key === 'anyOf') {
      if (Array.isArray(value)) out.anyOf = value.filter(isObject).map((child) => sanitizeGeminiSchema(child));
    } else {
      out[key] = value;
    }
  }
  if (Array.isArray(out.required) && isObject(out.properties)) {
    const names = new Set(Object.keys(out.properties));
    out.required = out.required.filter((name) => typeof name === 'string' && names.has(name));
    if (!(out.required as unknown[]).length) delete out.required;
  }
  return out;
}

export type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters?: JsonObject;
};

/**
 * Build a Gemini function declaration from an Anthropic-style tool. A tool that
 * takes no arguments omits `parameters`, since Gemini rejects an OBJECT with no
 * properties.
 */
export function toGeminiFunctionDeclaration(tool: {
  name: string;
  description: string;
  input_schema: unknown;
}): GeminiFunctionDeclaration {
  const parameters = sanitizeGeminiSchema(tool.input_schema);
  if (!Object.keys(parameters).length || isEmptyObjectSchema(parameters)) {
    return { name: tool.name, description: tool.description };
  }
  return { name: tool.name, description: tool.description, parameters };
}
