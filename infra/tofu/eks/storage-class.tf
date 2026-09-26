# StorageClass predefinita.
#
# Un cluster EKS creato dalla versione 1.30 in poi non ha nessuna StorageClass
# predefinita: il PersistentVolumeClaim del PostgreSQL del chart, che non ne
# indica una, resterebbe Pending per sempre. Questa usa il driver CSI di EBS
# (componente aggiuntivo in cluster.tf), volumi gp3 cifrati, creati nella zona
# del pod che li monta.
#
# Un volume EBS vive in una zona: il pod del database resta legato alla zona
# in cui è nato, e deve esserci un nodo delle applicazioni in quella zona.

resource "kubernetes_storage_class_v1" "gp3" {
  count = var.create_default_storage_class ? 1 : 0

  metadata {
    name = "gp3"

    annotations = {
      "storageclass.kubernetes.io/is-default-class" = "true"
    }
  }

  storage_provisioner    = "ebs.csi.aws.com"
  reclaim_policy         = "Delete"
  volume_binding_mode    = "WaitForFirstConsumer"
  allow_volume_expansion = true

  parameters = {
    type                        = "gp3"
    encrypted                   = "true"
    "csi.storage.k8s.io/fstype" = "ext4"
  }

  depends_on = [
    aws_eks_addon.ebs_csi,
    aws_eks_access_policy_association.admin,
  ]
}
