import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeGeminiSchema, toGeminiFunctionDeclaration } from '../src/shared/geminiSchema.js';
import { geminiLookupTools } from '../src/shared/askReasoning.js';
import { ASK_LOOKUP_TOOLS } from '../src/shared/askLookup.js';

const UNSUPPORTED = ['additionalProperties', '$schema', '$ref', '$defs', 'definitions', 'const', 'oneOf', 'allOf', 'not'];

/** Schema keywords used at every level (property names are not keywords). */
function schemaKeywords(schema: unknown, out: string[] = []): string[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return out;
  const node = schema as Record<string, unknown>;
  out.push(...Object.keys(node));
  if (node.properties && typeof node.properties === 'object') {
    for (const child of Object.values(node.properties)) schemaKeywords(child, out);
  }
  if (node.items) schemaKeywords(node.items, out);
  if (Array.isArray(node.anyOf)) for (const child of node.anyOf) schemaKeywords(child, out);
  return out;
}

test('sanitizeGeminiSchema strips JSON Schema keys Gemini rejects, at every depth', () => {
  const out = sanitizeGeminiSchema({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'Words', minLength: 1, const: 'x' },
      filters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tags: { type: 'array', items: { type: 'string', additionalProperties: false } },
          when: { anyOf: [{ type: 'string', $ref: '#/x' }, { type: 'number' }] },
        },
      },
    },
    required: ['query'],
  });
  assert.deepEqual(out, {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words', minLength: 1 },
      filters: {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
          when: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        },
      },
    },
    required: ['query'],
  });
});

test('sanitizeGeminiSchema keeps a property literally named like a JSON Schema keyword', () => {
  const out = sanitizeGeminiSchema({
    type: 'object',
    properties: { additionalProperties: { type: 'string' } },
    required: ['additionalProperties', 'missing'],
  });
  assert.deepEqual(out, {
    type: 'object',
    properties: { additionalProperties: { type: 'string' } },
    required: ['additionalProperties'],
  });
});

test('a tool with no arguments omits parameters (Gemini rejects an empty OBJECT)', () => {
  const decl = toGeminiFunctionDeclaration({
    name: 'read_job_history',
    description: 'Read job history.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  });
  assert.deepEqual(decl, { name: 'read_job_history', description: 'Read job history.' });
  assert.equal('parameters' in decl, false);
});

test('Gemini lookup tools carry no unsupported schema keys and no empty OBJECT parameters', () => {
  const [{ functionDeclarations }] = geminiLookupTools();
  assert.equal(functionDeclarations.length, ASK_LOOKUP_TOOLS.length);
  assert.deepEqual(
    functionDeclarations.map((decl) => decl.name),
    ASK_LOOKUP_TOOLS.map((tool) => tool.name),
  );
  for (const decl of functionDeclarations) {
    const params = decl.parameters;
    if (params) {
      const properties = params.properties as Record<string, unknown> | undefined;
      assert.ok(properties && Object.keys(properties).length > 0, `${decl.name} has an empty OBJECT`);
      const bad = schemaKeywords(params).filter((key) => UNSUPPORTED.includes(key));
      assert.deepEqual(bad, [], `${decl.name} sends unsupported schema keys`);
    }
  }
  const history = functionDeclarations.find((decl) => decl.name === 'read_job_history');
  assert.ok(history, 'read_job_history is declared');
  assert.equal(history.parameters, undefined);
  const search = functionDeclarations.find((decl) => decl.name === 'search_transcripts');
  assert.deepEqual(search?.parameters?.required, ['query']);
});
