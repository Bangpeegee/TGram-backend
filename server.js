const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json());

// ================================
// DATABASE
// ================================

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL belum tersedia!");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test database connection
pool.query("SELECT NOW()")
  .then(result => {
    console.log("PostgreSQL connected:", result.rows[0].now);
  })
  .catch(error => {
    console.error("PostgreSQL connection error:", error.message);
  });


// ================================
// HEALTH CHECK
// ================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    project: "TGram Backend",
    status: "online"
  });
});


app.get("/api/health", async (req, res) => {

  try {

    const result = await pool.query("SELECT NOW() AS time");

    res.json({
      success: true,
      status: "online",
      database: "connected",
      server_time: result.rows[0].time
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      status: "online",
      database: "error"
    });

  }

});


// ================================
// SERVER
// ================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TGram backend running on port ${PORT}`);
});
