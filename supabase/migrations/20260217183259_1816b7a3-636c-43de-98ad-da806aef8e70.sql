
-- ==========================================
-- ReceiptVault Database Schema
-- ==========================================

-- 1. Roles enum and user_roles table
CREATE TYPE public.app_role AS ENUM ('admin', 'processor', 'viewer');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'processor',
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 2. Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Receipt status enums
CREATE TYPE public.receipt_status AS ENUM ('needs_review', 'finalized', 'exception');
CREATE TYPE public.transfer_status AS ENUM ('untransferred', 'transferred', 'reversed');
CREATE TYPE public.batch_status AS ENUM ('draft', 'ready', 'transferred', 'reversed');

-- 4. Receipts table
CREATE TABLE public.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id TEXT NOT NULL UNIQUE DEFAULT ('RCV-' || to_char(now(), 'YYYY') || '-' || lpad(floor(random() * 100000)::text, 5, '0')),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  property TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  tenant TEXT NOT NULL DEFAULT '',
  receipt_date DATE,
  rent_month TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_type TEXT DEFAULT '',
  reference TEXT DEFAULT '',
  memo TEXT DEFAULT '',
  confidence_scores JSONB DEFAULT '{}',
  status receipt_status NOT NULL DEFAULT 'needs_review',
  transfer_status transfer_status NOT NULL DEFAULT 'untransferred',
  batch_id UUID,
  transferred_at TIMESTAMPTZ,
  transferred_by UUID REFERENCES auth.users(id),
  file_path TEXT,
  file_name TEXT,
  original_text TEXT DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

-- 5. Deposit Batches table
CREATE TABLE public.deposit_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id TEXT NOT NULL UNIQUE DEFAULT ('BATCH-' || lpad(floor(random() * 10000)::text, 4, '0')),
  property TEXT NOT NULL,
  deposit_period TEXT,
  status batch_status NOT NULL DEFAULT 'draft',
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  receipt_count INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  transferred_at TIMESTAMPTZ,
  transfer_method TEXT,
  external_reference TEXT,
  transferred_by UUID REFERENCES auth.users(id),
  notes TEXT DEFAULT ''
);

ALTER TABLE public.deposit_batches ENABLE ROW LEVEL SECURITY;

-- Add FK from receipts to deposit_batches
ALTER TABLE public.receipts 
  ADD CONSTRAINT fk_receipts_batch 
  FOREIGN KEY (batch_id) REFERENCES public.deposit_batches(id) ON DELETE SET NULL;

-- 6. Audit logs table
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 7. Upload batches (track batch uploads)
CREATE TABLE public.upload_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  file_count INT NOT NULL DEFAULT 0,
  processed_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.upload_batches ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- Helper Functions (SECURITY DEFINER)
-- ==========================================

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
$$;

CREATE OR REPLACE FUNCTION public.is_processor_or_above()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'processor')
$$;

CREATE OR REPLACE FUNCTION public.is_authenticated_with_role()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()
  )
$$;

-- ==========================================
-- RLS Policies
-- ==========================================

-- user_roles: users can read their own, admins can manage all
CREATE POLICY "Users can read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- profiles: users can read all, update own
CREATE POLICY "Authenticated users can read profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_authenticated_with_role());

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- receipts: all authenticated can read, processors+ can write
CREATE POLICY "Authenticated users can read receipts" ON public.receipts
  FOR SELECT TO authenticated
  USING (public.is_authenticated_with_role());

CREATE POLICY "Processors can insert receipts" ON public.receipts
  FOR INSERT TO authenticated
  WITH CHECK (public.is_processor_or_above());

CREATE POLICY "Processors can update receipts" ON public.receipts
  FOR UPDATE TO authenticated
  USING (public.is_processor_or_above());

CREATE POLICY "Admins can delete receipts" ON public.receipts
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- deposit_batches: all can read, processors+ can write
CREATE POLICY "Authenticated users can read batches" ON public.deposit_batches
  FOR SELECT TO authenticated
  USING (public.is_authenticated_with_role());

CREATE POLICY "Processors can insert batches" ON public.deposit_batches
  FOR INSERT TO authenticated
  WITH CHECK (public.is_processor_or_above());

CREATE POLICY "Processors can update batches" ON public.deposit_batches
  FOR UPDATE TO authenticated
  USING (public.is_processor_or_above());

CREATE POLICY "Admins can delete batches" ON public.deposit_batches
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- audit_logs: all can read, system/admins insert
CREATE POLICY "Authenticated users can read audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_authenticated_with_role());

CREATE POLICY "Processors can insert audit logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_processor_or_above());

-- upload_batches
CREATE POLICY "Authenticated users can read upload batches" ON public.upload_batches
  FOR SELECT TO authenticated
  USING (public.is_authenticated_with_role());

CREATE POLICY "Processors can manage upload batches" ON public.upload_batches
  FOR ALL TO authenticated
  USING (public.is_processor_or_above())
  WITH CHECK (public.is_processor_or_above());

-- ==========================================
-- Triggers
-- ==========================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_receipts_updated_at
  BEFORE UPDATE ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_deposit_batches_updated_at
  BEFORE UPDATE ON public.deposit_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile + assign processor role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'processor');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==========================================
-- Storage bucket for receipt files
-- ==========================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false);

CREATE POLICY "Authenticated users can read receipt files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts' AND public.is_authenticated_with_role());

CREATE POLICY "Processors can upload receipt files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND public.is_processor_or_above());

CREATE POLICY "Processors can update receipt files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'receipts' AND public.is_processor_or_above());

CREATE POLICY "Admins can delete receipt files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'receipts' AND public.is_admin());
