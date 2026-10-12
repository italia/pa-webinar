// Interfaccia della conferenza nello stack locale (docker-compose): niente
// logo e niente link di Jitsi sopra la chiamata, come nelle installazioni
// su Kubernetes. L'immagine jitsi/web aggiunge questo file in coda al suo
// interface_config.js all'avvio del contenitore.
interfaceConfig.SHOW_JITSI_WATERMARK = false;
interfaceConfig.SHOW_WATERMARK_FOR_GUESTS = false;
interfaceConfig.SHOW_BRAND_WATERMARK = false;
interfaceConfig.JITSI_WATERMARK_LINK = '';
interfaceConfig.BRAND_WATERMARK_LINK = '';
interfaceConfig.SHOW_POWERED_BY = false;
interfaceConfig.DEFAULT_LOGO_URL = '';
