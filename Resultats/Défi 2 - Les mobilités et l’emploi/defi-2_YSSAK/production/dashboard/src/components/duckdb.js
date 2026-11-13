// Chargement des fichiers Parquet dans DuckDB-wasm : téléchargement complet, sans lecture par plages.
//
// Pourquoi : par défaut, DuckDB-wasm lit un Parquet par requêtes HTTP partielles et se fie à la taille
// annoncée par le serveur. Or GitHub Pages sert les .parquet compressés en gzip : la taille annoncée est
// celle du fichier compressé (ex. 384 484 octets au lieu de 386 314). Selon le navigateur, DuckDB lit
// alors le pied de fichier au mauvais endroit -> « TProtocolException: Invalid data ».
//
// En téléchargeant le fichier en entier (fetch classique), le navigateur le décompresse lui-même et
// DuckDB reçoit les octets exacts. Les fichiers sont petits (< 1,2 Mo), le coût est négligeable.
//
// Usage dans une page (les blocs ```sql utilisent automatiquement ce `sql`) :
//   const sql = DuckDBClient.sql(tablesCompletes({dim_geo: FileAttachment("./data/dim_geo.parquet")}));

export function tablesCompletes(tables) {
  return Object.fromEntries(
    Object.entries(tables).map(([nom, fichier]) => [
      nom,
      {
        name: fichier.name,
        mimeType: fichier.mimeType,
        size: 0, // < 50 Mo : DuckDB crée une vraie table en mémoire
        // Une URL « blob: » indique à DuckDBClient d'utiliser arrayBuffer() au lieu de lire par plages.
        url: async () => "blob:telechargement-complet",
        arrayBuffer: () => fichier.arrayBuffer()
      }
    ])
  );
}
