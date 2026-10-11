# One JorKonvo Matrix server: a Hetzner Cloud VM (hourly billing, capped
# monthly) + Cloudflare DNS for every sub-domain + cloud-init that installs
# Docker and brings the whole stack up.
#
# This is the unit the rental automation calls once per customer. Run many by
# using a Terraform workspace per tenant, or wrap it in a module and iterate.
#
#   terraform init
#   terraform apply -var-file=tenant.tfvars

terraform {
  required_version = ">= 1.6"
  required_providers {
    hcloud     = { source = "hetznercloud/hcloud", version = "~> 1.49" }
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.40" }
  }
}

variable "hcloud_token" {
  sensitive = true
}
variable "cloudflare_token" {
  sensitive = true
}
variable "cloudflare_zone_id" {}

variable "tenant" {
  description = "short slug, used for the server name"
}
variable "server_type" {
  description = "cx22 (2vCPU/4GB, ~€4/mo) is the sane minimum; cx32 (4vCPU/8GB) for a busy space"
  default     = "cx22"
}
variable "location" {
  default = "nbg1" # nbg1/fsn1/hel1 EU, ash/hil US
}
variable "apex_domain" {}   # chat.example.com
variable "base_domain" {}   # example.com  (records are created under this zone)
variable "acme_email" {}
variable "admin_username" {}
variable "admin_password" {
  sensitive = true
}
variable "ssh_key_ids" {
  type    = list(string)
  default = []
}
variable "deploy_tarball_url" {
  default = ""
}
variable "open_registration" {
  default = "false"
}

provider "hcloud" { token = var.hcloud_token }
provider "cloudflare" { api_token = var.cloudflare_token }

locals {
  sub = {
    matrix  = "matrix.${var.base_domain}"
    livekit = "livekit.${var.base_domain}"
    lkjwt   = "rtc-jwt.${var.base_domain}"
    mas     = "auth.${var.base_domain}"
    admin   = "admin.${var.base_domain}"
  }

  # The cloud-init file uses {{PLACEHOLDER}} markers (so it stays usable
  # standalone with sed) - fill them explicitly here rather than with
  # templatefile(), whose ${...} syntax would collide with the embedded bash.
  ci_raw = file("${path.module}/../scripts/hetzner-cloud-init.yaml")
  ci_1   = replace(local.ci_raw, "{{APEX_DOMAIN}}", var.apex_domain)
  ci_2   = replace(local.ci_1, "{{MATRIX_DOMAIN}}", local.sub.matrix)
  ci_3   = replace(local.ci_2, "{{LIVEKIT_DOMAIN}}", local.sub.livekit)
  ci_4   = replace(local.ci_3, "{{LK_JWT_DOMAIN}}", local.sub.lkjwt)
  ci_5   = replace(local.ci_4, "{{MAS_DOMAIN}}", local.sub.mas)
  ci_6   = replace(local.ci_5, "{{ADMIN_DOMAIN}}", local.sub.admin)
  ci_7   = replace(local.ci_6, "{{ACME_EMAIL}}", var.acme_email)
  ci_8   = replace(local.ci_7, "{{ENABLE_OPEN_REGISTRATION}}", var.open_registration)
  ci_9   = replace(local.ci_8, "{{DEPLOY_TARBALL_URL}}", var.deploy_tarball_url)
  ci_10  = replace(local.ci_9, "{{ADMIN_USERNAME}}", var.admin_username)
  cloud_init = replace(local.ci_10, "{{ADMIN_PASSWORD}}", var.admin_password)
}

resource "hcloud_server" "node" {
  name        = "jorkonvo-${var.tenant}"
  server_type = var.server_type
  image       = "ubuntu-24.04"
  location    = var.location
  ssh_keys    = var.ssh_key_ids
  user_data   = local.cloud_init
  labels      = { app = "jorkonvo", tenant = var.tenant }

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }
}

# DNS: apex + every sub-domain -> the new server.
resource "cloudflare_record" "apex" {
  for_each = toset(concat([var.apex_domain], values(local.sub)))
  zone_id  = var.cloudflare_zone_id
  name     = each.value
  type     = "A"
  content  = hcloud_server.node.ipv4_address
  proxied  = false # Matrix federation + WebRTC need the real IP
  ttl      = 300
}

# Federation delegation so users are @name:base_domain if you want the short form.
resource "cloudflare_record" "wellknown_srv" {
  zone_id = var.cloudflare_zone_id
  name    = "_matrix._tcp.${var.base_domain}"
  type    = "SRV"
  ttl     = 300
  data {
    service  = "_matrix"
    proto    = "_tcp"
    name     = var.base_domain
    priority = 10
    weight   = 0
    port     = 443
    target   = local.sub.matrix
  }
}

output "server_ip" { value = hcloud_server.node.ipv4_address }
output "matrix_domain" { value = local.sub.matrix }
output "login_url" { value = "https://${var.apex_domain}" }
