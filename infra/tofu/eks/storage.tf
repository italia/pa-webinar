# Storage degli oggetti: un bucket S3 privato per entrambi i domini del
# portale (materiali e registrazioni, le cui chiavi non si sovrappongono) e un
# utente IAM con chiavi statiche.
#
# Chiavi statiche perché il portale oggi legge solo quelle
# (STORAGE_FILES_S3_* e RECORDING_S3_*): senza una coppia di chiavi il dominio
# resta spento. Pod Identity e IRSA non sono usati dal portale.
#
# Il bucket non è mai pubblico: ogni lettura passa da un URL firmato dal
# portale. I browser caricano i video e i materiali direttamente nel bucket
# con URL firmati, per questo servono il CORS e la regola sui caricamenti
# incompleti.

locals {
  bucket_name = var.s3_bucket_name != "" ? var.s3_bucket_name : "${var.name}-media-${local.account_id}-${var.region}"
}

resource "aws_kms_key" "storage" {
  description             = "${var.name}: cifratura del bucket di materiali e registrazioni"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "storage" {
  name          = "alias/${var.name}-storage"
  target_key_id = aws_kms_key.storage.key_id
}

# Nessun versionamento, di proposito: il portale cancella registrazioni e
# dati personali alla scadenza della conservazione, e un bucket versionato ne
# terrebbe una copia non corrente che nessun processo del portale rimuove.
#trivy:ignore:AVD-AWS-0090 Versionamento spento di proposito: le cancellazioni per conservazione dei dati personali devono essere definitive.
#trivy:ignore:AVD-AWS-0089 Log di accesso al bucket non attivati: si aggiungono con aws_s3_bucket_logging verso un bucket di log dell'ente.
resource "aws_s3_bucket" "media" {
  bucket = local.bucket_name

  lifecycle {
    # Controllato nel piano: S3 rifiuterebbe il nome solo in fase di apply,
    # quando VPC e cluster sono già creati.
    precondition {
      condition     = length(local.bucket_name) >= 3 && length(local.bucket_name) <= 63
      error_message = "Il nome del bucket (${local.bucket_name}) deve stare fra 3 e 63 caratteri: con un name lungo quello predefinito li supera. Indica un nome più corto in s3_bucket_name."
    }
  }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket = aws_s3_bucket.media.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.storage.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = var.s3_abort_incomplete_multipart_days
    }
  }
}

# Caricamenti dal browser: PUT firmati dall'origine del portale, con il solo
# Content-Type. La riproduzione non ha bisogno del CORS.
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = var.portal_origins
    allowed_headers = ["Content-Type"]
    max_age_seconds = 3600
  }
}

data "aws_iam_policy_document" "media_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.media.arn,
      "${aws_s3_bucket.media.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  policy = data.aws_iam_policy_document.media_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.media]
}

# ── Utente IAM del portale ───────────────────────────────────
# Le azioni sono quelle elencate in docs/configuration/storage.md
# ("Creating buckets and containers"), più la chiave KMS del bucket.

#trivy:ignore:AVD-AWS-0143 Il portale accetta solo chiavi statiche di un utente IAM: la policy è legata all'unico utente che le usa, limitata a questo bucket.
resource "aws_iam_user" "storage" {
  name = "${var.name}-storage"
}

data "aws_iam_policy_document" "storage" {
  statement {
    sid       = "ListBucket"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.media.arn]
  }

  statement {
    sid = "Objects"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${aws_s3_bucket.media.arn}/*"]
  }

  statement {
    sid = "BucketKey"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey",
    ]
    resources = [aws_kms_key.storage.arn]
  }
}

resource "aws_iam_user_policy" "storage" {
  name   = "pa-webinar-storage"
  user   = aws_iam_user.storage.name
  policy = data.aws_iam_policy_document.storage.json
}

resource "aws_iam_access_key" "storage" {
  count = var.s3_create_access_key ? 1 : 0

  user = aws_iam_user.storage.name
}
