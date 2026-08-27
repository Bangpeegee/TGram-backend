const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json());

/* ================================
   DATABASE
================================ */

const db = new Database("tgram.db");

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    wallet_address TEXT UNIQUE,
    balance_tgr REAL DEFAULT 0,
    referral_code TEXT UNIQUE NOT NULL,
    referred_by INTEGER,
    wallet_connected INTEGER DEFAULT 0,
    connect_reward_claimed INTEGER DEFAULT 0,
    hodl_balance REAL DEFAULT 0,
    hodl_verified INTEGER DEFAULT 0,
    group_joined INTEGER DEFAULT 0,
    mining_active INTEGER DEFAULT 0,
    mining_started_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mining_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    reward_tgr REAL DEFAULT 0,
    active INTEGER DEFAULT 1,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER NOT NULL,
    referred_user_id INTEGER UNIQUE NOT NULL,
    reward_tgr REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(referrer_id) REFERENCES users(id),
    FOREIGN KEY(referred_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reward_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount_tgr REAL NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_key TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    reward_tgr REAL DEFAULT 0,
    enabled INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    task_id INTEGER NOT NULL,
    completed INTEGER DEFAULT 0,
    completed_at TEXT,
    UNIQUE(user_id, task_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(task_id) REFERENCES tasks(id)
);
`);

db.prepare(`
INSERT OR IGNORE INTO tasks
(task_key, title, reward_tgr)
VALUES
('join_group', 'Join TGram Group', 500)
`).run();


/* ================================
   HELPERS
================================ */

function generateReferralCode() {
    return "TGR-" +
        crypto.randomBytes(4)
        .toString("hex")
        .toUpperCase();
}

function createUniqueReferralCode() {

    let code;

    do {
        code = generateReferralCode();

        const exists = db.prepare(`
            SELECT id
            FROM users
            WHERE referral_code = ?
        `).get(code);

        if (!exists) return code;

    } while (true);
}


/* ================================
   ROOT
================================ */

app.get("/", (req, res) => {

    res.json({
        success: true,
        project: "TGram",
        status: "online",
        database: "sqlite"
    });

});


/* ================================
   HEALTH
================================ */

app.get("/api/health", (req, res) => {

    try {

        db.prepare("SELECT 1").get();

        res.json({
            success: true,
            status: "online",
            database: "connected"
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


/* ================================
   CREATE / GET USER
================================ */

app.post("/api/user", (req, res) => {

    try {

        const {
            telegram_id,
            username = null,
            first_name = null,
            referral_code = null
        } = req.body;

        if (!telegram_id) {

            return res.status(400).json({
                success: false,
                message: "telegram_id required"
            });

        }

        let user = db.prepare(`
            SELECT *
            FROM users
            WHERE telegram_id = ?
        `).get(String(telegram_id));

        if (user) {

            return res.json({
                success: true,
                user
            });

        }

        let referredBy = null;

        if (referral_code) {

            const referrer = db.prepare(`
                SELECT id
                FROM users
                WHERE referral_code = ?
            `).get(referral_code);

            if (referrer) {
                referredBy = referrer.id;
            }
        }

        const newReferralCode =
            createUniqueReferralCode();

        const result = db.prepare(`
            INSERT INTO users (
                telegram_id,
                username,
                first_name,
                referral_code,
                referred_by
            )
            VALUES (?, ?, ?, ?, ?)
        `).run(
            String(telegram_id),
            username,
            first_name,
            newReferralCode,
            referredBy
        );

        const userId = result.lastInsertRowid;

        if (referredBy) {

            db.prepare(`
                INSERT OR IGNORE INTO referrals (
                    referrer_id,
                    referred_user_id,
                    reward_tgr
                )
                VALUES (?, ?, 0)
            `).run(
                referredBy,
                userId
            );

        }

        user = db.prepare(`
            SELECT *
            FROM users
            WHERE id = ?
        `).get(userId);

        res.json({
            success: true,
            user
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Database error"
        });

    }

});


/* ================================
   GET USER
================================ */

app.get("/api/user/:telegram_id", (req, res) => {

    const user = db.prepare(`
        SELECT *
        FROM users
        WHERE telegram_id = ?
    `).get(String(req.params.telegram_id));

    if (!user) {

        return res.status(404).json({
            success: false,
            message: "User not found"
        });

    }

    res.json({
        success: true,
        user
    });

});


/* ================================
   REFERRAL
================================ */

app.get("/api/referral/:telegram_id", (req, res) => {

    const user = db.prepare(`
        SELECT id, referral_code
        FROM users
        WHERE telegram_id = ?
    `).get(String(req.params.telegram_id));

    if (!user) {

        return res.status(404).json({
            success: false,
            message: "User not found"
        });

    }

    const count = db.prepare(`
        SELECT COUNT(*) AS total
        FROM referrals
        WHERE referrer_id = ?
    `).get(user.id);

    res.json({
        success: true,
        referral_code: user.referral_code,
        referral_link:
            "https://t.me/TGramBot?start=" +
            user.referral_code,
        referrals: count.total
    });

});


/* ================================
   CONNECT WALLET REWARD
================================ */

app.post("/api/wallet/connect", (req, res) => {

    try {

        const {
            telegram_id,
            wallet_address
        } = req.body;

        if (!telegram_id || !wallet_address) {

            return res.status(400).json({
                success: false,
                message: "telegram_id and wallet_address required"
            });

        }

        const user = db.prepare(`
            SELECT *
            FROM users
            WHERE telegram_id = ?
        `).get(String(telegram_id));

        if (!user) {

            return res.status(404).json({
                success: false,
                message: "User not found"
            });

        }

        if (user.connect_reward_claimed) {

            return res.json({
                success: true,
                reward: 0,
                message: "Connect reward already claimed"
            });

        }

        const reward = 1000;

        const transaction = db.transaction(() => {

            db.prepare(`
                UPDATE users
                SET
                    wallet_address = ?,
                    wallet_connected = 1,
                    connect_reward_claimed = 1,
                    balance_tgr = balance_tgr + ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(
                wallet_address,
                reward,
                user.id
            );

            db.prepare(`
                INSERT INTO reward_transactions
                (user_id, type, amount_tgr, description)
                VALUES (?, ?, ?, ?)
            `).run(
                user.id,
                "connect_wallet",
                reward,
                "Connect Wallet Reward"
            );

        });

        transaction();

        res.json({
            success: true,
            reward
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Wallet connection error"
        });

    }

});


/* ================================
   START MINING
================================ */

app.post("/api/mining/start", (req, res) => {

    try {

        const { telegram_id } = req.body;

        const user = db.prepare(`
            SELECT *
            FROM users
            WHERE telegram_id = ?
        `).get(String(telegram_id));

        if (!user) {

            return res.status(404).json({
                success: false,
                message: "User not found"
            });

        }

        if (!user.wallet_connected) {

            return res.status(403).json({
                success: false,
                message: "Connect TON wallet first"
            });

        }

        if (Number(user.hodl_balance) < 10000) {

            return res.status(403).json({
                success: false,
                message: "Minimum HODL requirement is 10,000 TGR"
            });

        }

        if (user.mining_active) {

            return res.json({
                success: true,
                message: "Mining already active"
            });

        }

        const now = new Date().toISOString();

        db.prepare(`
            UPDATE users
            SET
                mining_active = 1,
                mining_started_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(now, user.id);

        db.prepare(`
            INSERT INTO mining_sessions
            (user_id, started_at)
            VALUES (?, ?)
        `).run(user.id, now);

        res.json({
            success: true,
            mining: true,
            started_at: now
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Mining start error"
        });

    }

});


/* ================================
   MINING STATUS
================================ */

app.get("/api/mining/:telegram_id", (req, res) => {

    const user = db.prepare(`
        SELECT *
        FROM users
        WHERE telegram_id = ?
    `).get(String(req.params.telegram_id));

    if (!user) {

        return res.status(404).json({
            success: false,
            message: "User not found"
        });

    }

    res.json({
        success: true,
        mining_active: Boolean(user.mining_active),
        hodl_balance: user.hodl_balance,
        balance_tgr: user.balance_tgr,
        mining_started_at: user.mining_started_at
    });

});


/* ================================
   SERVER
================================ */

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {

    console.log(
        `TGram backend running on port ${PORT}`
    );

});
