# Rete: una VPC con sottoreti pubbliche e private in az_count zone.
#
# - Pubbliche (/24): NAT gateway, bilanciatori esposti a Internet (portale,
#   bridge, TURN) e, solo con jvb_exposure = "node-public-ip", i nodi dei
#   bridge con il loro indirizzo pubblico.
# - Private (/19): tutti gli altri nodi. Il VPC CNI assegna ai pod indirizzi
#   della VPC, per questo sono larghe.
# - Endpoint gateway S3: il traffico dei nodi verso il bucket (Jibri, bot di
#   registrazione, worker AI) non passa dal NAT, che si paga a gigabyte.

data "aws_availability_zones" "available" {
  state = "available"

  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  # /19 private dall'inizio del blocco, /24 pubbliche in fondo.
  private_subnet_cidrs = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 3, i)]
  public_subnet_cidrs  = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 8, 240 + i)]

  # Con i bridge sui nodi pubblici EKS pretende che la sottorete assegni da sé
  # l'indirizzo pubblico alle istanze: senza, il gruppo di nodi non si crea.
  public_subnet_auto_public_ip = var.jvb_exposure == "node-public-ip"

  nat_gateway_count = var.one_nat_gateway_per_az ? var.az_count : 1

  # Zona del bilanciatore del bridge. Un indice fuori intervallo lo ferma la
  # precondizione del cluster; qui lo si tiene dentro per arrivarci.
  jvb_az = min(var.jvb_az_index, var.az_count - 1)
}

#trivy:ignore:AVD-AWS-0178 Flow log non attivati: il traffico dei media è voluminoso e il costo cresce con esso. Si aggiungono con aws_flow_log se la policy dell'ente li chiede.
resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = var.name }
}

# Il gruppo di sicurezza predefinito della VPC resta senza regole: nessuna
# risorsa di questo modulo lo usa, e così non apre nulla per sbaglio.
resource "aws_default_security_group" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name}-default-unused" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = var.name }
}

#trivy:ignore:AVD-AWS-0164 Assegnazione automatica dell'IP pubblico solo con jvb_exposure = "node-public-ip", dove i bridge devono essere raggiungibili sul proprio nodo.
resource "aws_subnet" "public" {
  count = var.az_count

  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_subnet_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = local.public_subnet_auto_public_ip

  tags = {
    Name                                = "${var.name}-public-${local.azs[count.index]}"
    "kubernetes.io/role/elb"            = "1"
    "kubernetes.io/cluster/${var.name}" = "shared"
  }
}

resource "aws_subnet" "private" {
  count = var.az_count

  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_subnet_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = {
    Name                                = "${var.name}-private-${local.azs[count.index]}"
    "kubernetes.io/role/internal-elb"   = "1"
    "kubernetes.io/cluster/${var.name}" = "shared"
  }
}

resource "aws_eip" "nat" {
  count  = local.nat_gateway_count
  domain = "vpc"

  tags = { Name = "${var.name}-nat-${count.index}" }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_nat_gateway" "this" {
  count = local.nat_gateway_count

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = { Name = "${var.name}-${local.azs[count.index]}" }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = { Name = "${var.name}-public" }
}

resource "aws_route_table_association" "public" {
  count = var.az_count

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = var.az_count
  vpc_id = aws_vpc.this.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[var.one_nat_gateway_per_az ? count.index : 0].id
  }

  tags = { Name = "${var.name}-private-${local.azs[count.index]}" }
}

resource "aws_route_table_association" "private" {
  count = var.az_count

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat(aws_route_table.private[*].id, [aws_route_table.public.id])

  tags = { Name = "${var.name}-s3" }
}

# ── Indirizzi pubblici fissi dei media ───────────────────────
#
# Il bridge annuncia ai browser un indirizzo che deve restare lo stesso a ogni
# riavvio: con jvb_exposure = "nlb" è questo Elastic IP, legato al
# bilanciatore UDP creato da AWS Load Balancer Controller nella sottorete
# pubblica della zona jvb_az_index (annotazioni in `helm_values`).

resource "aws_eip" "jvb" {
  count  = var.jvb_exposure == "nlb" ? 1 : 0
  domain = "vpc"

  tags = { Name = "${var.name}-jvb" }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_eip" "turn" {
  count  = var.turn_enabled ? 1 : 0
  domain = "vpc"

  tags = { Name = "${var.name}-turn" }

  depends_on = [aws_internet_gateway.this]
}
