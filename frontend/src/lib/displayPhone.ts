/** "(972) 555-0142" for a US number; anything else as given. */
export function displayPhone(raw: string | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : String(raw ?? '');
}
