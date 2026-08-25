/** How field clients should upload day film bytes for a minted URL. */
export type ProofUploadTransport = {
  method: 'PUT' | 'POST';
  useSupabaseAuth: boolean;
};

/**
 * BFF `createSignedUploadUrl` returns `/storage/v1/object/upload/sign/…` (PUT).
 * The iOS Supabase fallback posts straight to `/storage/v1/object/job-proofs/…`.
 */
export function proofUploadTransport(uploadUrl: string): ProofUploadTransport {
  const isDirectStoragePost =
    uploadUrl.includes('/storage/v1/object/job-proofs/') &&
    !uploadUrl.includes('/upload/sign/');
  return {
    method: isDirectStoragePost ? 'POST' : 'PUT',
    useSupabaseAuth: isDirectStoragePost,
  };
}
