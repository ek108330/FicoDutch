const fs = require("node:fs");
const path = require("node:path");

async function openDatabase({ url = process.env.DATABASE_URL, local = process.env.FICODUTCH_LOCAL_DB } = {}) {
  let db;
  if (url) {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5_000 });
    pool.on("error", (error) => console.error("Connexion PostgreSQL inactive :", error.code));
    db = {
      query: pool.query.bind(pool),
      close: pool.end.bind(pool),
      migrate: (sql) => pool.query(sql),
      async transaction(work) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const value = await work(client);
          await client.query("COMMIT");
          return value;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    };
  } else if (local) {
    const { PGlite } = require("@electric-sql/pglite");
    const embedded = new PGlite(local);
    db = {
      query: embedded.query.bind(embedded),
      close: embedded.close.bind(embedded),
      migrate: embedded.exec.bind(embedded),
      transaction: embedded.transaction.bind(embedded),
    };
  }
  if (db) await db.migrate(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
  return db;
}

module.exports = { openDatabase };
