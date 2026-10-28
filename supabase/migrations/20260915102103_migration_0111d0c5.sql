-- Create storage bucket for KYC documents if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('kyc-documents', 'kyc-documents', true)
ON CONFLICT (id) DO NOTHING;

-- Set up storage policies for kyc-documents bucket
DO $$
BEGIN
  -- Allow authenticated users to upload their own KYC documents
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can upload own KYC documents'
  ) THEN
    CREATE POLICY "Users can upload own KYC documents"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'kyc-documents' 
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  -- Allow authenticated users to read their own documents
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can read own KYC documents'
  ) THEN
    CREATE POLICY "Users can read own KYC documents"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'kyc-documents' 
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  -- Allow admins to read all KYC documents
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Admins can read all KYC documents'
  ) THEN
    CREATE POLICY "Admins can read all KYC documents"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'kyc-documents'
        AND EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.admin_role IN ('super_admin', 'kyc')
        )
      );
  END IF;
END $$;

-- Verify bucket created
SELECT id, name, public FROM storage.buckets WHERE id = 'kyc-documents';