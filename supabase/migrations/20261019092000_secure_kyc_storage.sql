UPDATE storage.buckets
SET public = FALSE,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
WHERE id = 'kyc-documents';

DROP POLICY IF EXISTS "Admins can read all KYC documents" ON storage.objects;
CREATE POLICY "kyc_reviewers_read_all_documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND public.has_admin_role(ARRAY['kyc'])
  );

