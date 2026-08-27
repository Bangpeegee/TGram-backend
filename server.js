const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json());

/* =========================================================
   CONFIG
========================================================= */

const PORT = process.env.PORT || 8080;

const TGRAM_BOT_USERNAME =
    process.env.TGRAM_BOT_USERNAME || "TGramBot";

const TGRAM_GROUP =
    process.env.TGRAM_GROUP ||
    "https://t.me/+opa1HGp3qbhkZWVl";

const TON_API_KEY =
    process.env.TON_API_KEY || "";

const TON_JETTON_MASTER =
    process.env.TON_JETTON_MASTER ||
    "EQDymqX9ZyAl_XRi_PefRsQkzwhirepe95ibUS_lB-9gc66z";

const MINIMUM_HODL = 10000;

const CONNECT_WALLET_REWARD = 1000;

const REFERRAL_REWARD = 5000;

const JOIN_GROUP_REWARD = 500;

const TGR_DECIMALS = 9;

/*
 * Contoh:
 * 0.001 TGR / detik
 *
 * Ini hanya simulasi mining.
 * Reward sebenarnya sebaiknya ditentukan
 * dari sistem tokenomics/backend kamu.
 */
const MINING_RATE_PER_SECOND =
    0.001;


/* =========================================================
   SQLITE
========================================================= */

const db = new Database("tgram.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");


/* =========================================================
   TABLES
========================================================= */

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

    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY(referred_by)
        REFERENCES users(id)
);


CREATE TABLE IF NOT EXISTS referrals (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    referrer_id INTEGER NOT NULL,

    referred_user_id INTEGER UNIQUE NOT NULL,

    reward_tgr REAL DEFAULT 0,

    rewarded INTEGER DEFAULT 0,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY(referrer_id)
        REFERENCES users(id),

    FOREIGN KEY(referred_user_id)
        REFERENCES users(id)
);


CREATE TABLE IF NOT EXISTS mining_sessions (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER NOT NULL,

    started_at TEXT NOT NULL,

    ended_at TEXT,

    reward_tgr REAL DEFAULT 0,

    active INTEGER DEFAULT 1,

    FOREIGN KEY(user_id)
        REFERENCES users(id)
);


CREATE TABLE IF NOT EXISTS reward_transactions (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER NOT NULL,

    type TEXT NOT NULL,

    amount_tgr REAL NOT NULL,

    description TEXT,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY(user_id)
        REFERENCES users(id)
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

    FOREIGN KEY(user_id)
        REFERENCES users(id),

    FOREIGN KEY(task_id)
        REFERENCES tasks(id)
);
`);


/* =========================================================
   DEFAULT TASKS
========================================================= */

db.prepare(`
INSERT OR IGNORE INTO tasks
(
    task_key,
    title,
    reward_tgr
)
VALUES
(
    'join_group',
    'Join TGram Group',
    ?
)
`).run(JOIN_GROUP_REWARD);


/* =========================================================
   HELPERS
========================================================= */

function generateReferralCode() {

    return "TGR-" +
        crypto
            .randomBytes(5)
            .toString("hex")
            .toUpperCase();

}


function createUniqueReferralCode() {

    while (true) {

        const code =
            generateReferralCode();

        const exists =
            db.prepare(`
                SELECT id
                FROM users
                WHERE referral_code = ?
            `).get(code);

        if (!exists) {

            return code;

        }

    }

}


function getUserByTelegramId(
    telegramId
) {

    return db.prepare(`
        SELECT *
        FROM users
        WHERE telegram_id = ?
    `).get(
        String(telegramId)
    );

}


function addReward(
    userId,
    type,
    amount,
    description
) {

    const transaction =
        db.transaction(() => {

            db.prepare(`
                UPDATE users

                SET balance_tgr =
                    balance_tgr + ?,

                    updated_at =
                    CURRENT_TIMESTAMP

                WHERE id = ?
            `).run(
                amount,
                userId
            );


            db.prepare(`
                INSERT INTO reward_transactions
                (
                    user_id,
                    type,
                    amount_tgr,
                    description
                )

                VALUES (?, ?, ?, ?)
            `).run(
                userId,
                type,
                amount,
                description
            );

        });

    transaction();

}


/* =========================================================
   TON TGR BALANCE
========================================================= */

async function getTGRBalance(
    walletAddress
) {

    if (!walletAddress) {

        throw new Error(
            "Wallet address required"
        );

    }


    /*
     * TON Center API
     */

    const url =
        "https://toncenter.com/api/v3/jetton/wallets" +
        "?owner_address=" +
        encodeURIComponent(walletAddress) +
        "&jetton_address=" +
        encodeURIComponent(TON_JETTON_MASTER) +
        "&limit=1";


    const headers = {};


    if (TON_API_KEY) {

        headers["X-API-Key"] =
            TON_API_KEY;

    }


    const response =
        await fetch(
            url,
            {
                method: "GET",
                headers
            }
        );


    if (!response.ok) {

        throw new Error(
            `TON API error ${response.status}`
        );

    }


    const data =
        await response.json();


    if (
        !data.jetton_wallets ||
        data.jetton_wallets.length === 0
    ) {

        return 0;

    }


    const rawBalance =
        BigInt(
            data.jetton_wallets[0].balance ||
            "0"
        );


    const divisor =
        10n ** BigInt(
            TGR_DECIMALS
        );


    const whole =
        rawBalance / divisor;


    const fraction =
        rawBalance % divisor;


    return Number(
        whole.toString() +
        "." +
        fraction
            .toString()
            .padStart(
                TGR_DECIMALS,
                "0"
            )
    );

}


/* =========================================================
   ROOT
========================================================= */

app.get("/", (req, res) => {

    res.json({

        success: true,

        project: "TGram",

        status: "online",

        database: "sqlite",

        mining: "Matrix Mining",

        minimum_hodl:
            MINIMUM_HODL

    });

});


/* =========================================================
   HEALTH
========================================================= */

app.get(
    "/api/health",
    (req, res) => {

        try {

            db.prepare(
                "SELECT 1"
            ).get();


            res.json({

                success: true,

                status: "online",

                database:
                    "connected"

            });

        } catch (error) {

            console.error(error);


            res.status(500).json({

                success: false,

                status: "online",

                database:
                    "error"

            });

        }

    }
);


/* =========================================================
   CREATE USER
========================================================= */

app.post(
    "/api/user",
    (req, res) => {

        try {

            const {

                telegram_id,

                username = null,

                first_name = null,

                referral_code = null

            } = req.body;


            if (!telegram_id) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "telegram_id required"

                    });

            }


            let user =
                getUserByTelegramId(
                    telegram_id
                );


            if (user) {

                return res.json({

                    success: true,

                    user

                });

            }


            let referredBy = null;


            if (referral_code) {

                const referrer =
                    db.prepare(`
                        SELECT id
                        FROM users
                        WHERE referral_code = ?
                    `).get(
                        referral_code
                    );


                if (
                    referrer &&
                    String(
                        telegram_id
                    ) !==
                    String(
                        referrer.telegram_id
                    )
                ) {

                    referredBy =
                        referrer.id;

                }

            }


            const referralCode =
                createUniqueReferralCode();


            const result =
                db.prepare(`
                    INSERT INTO users
                    (
                        telegram_id,
                        username,
                        first_name,
                        referral_code,
                        referred_by
                    )

                    VALUES (?, ?, ?, ?, ?)
                `).run(

                    String(
                        telegram_id
                    ),

                    username,

                    first_name,

                    referralCode,

                    referredBy

                );


            const userId =
                result.lastInsertRowid;


            /*
             * Simpan referral.
             */

            if (referredBy) {

                db.prepare(`
                    INSERT OR IGNORE INTO referrals
                    (
                        referrer_id,
                        referred_user_id,
                        reward_tgr
                    )

                    VALUES (?, ?, ?)
                `).run(

                    referredBy,

                    userId,

                    REFERRAL_REWARD

                );

            }


            user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE id = ?
                `).get(
                    userId
                );


            res.json({

                success: true,

                user

            });


        } catch (error) {

            console.error(error);


            res.status(500).json({

                success: false,

                message:
                    "Unable to create user"

            });

        }

    }
);


/* =========================================================
   GET USER
========================================================= */

app.get(
    "/api/user/:telegram_id",
    (req, res) => {

        const user =
            getUserByTelegramId(
                req.params.telegram_id
            );


        if (!user) {

            return res
                .status(404)
                .json({

                    success: false,

                    message:
                        "User not found"

                });

        }


        res.json({

            success: true,

            user

        });

    }
);


/* =========================================================
   CONNECT WALLET
========================================================= */

app.post(
    "/api/wallet/connect",
    (req, res) => {

        try {

            const {

                telegram_id,

                wallet_address

            } = req.body;


            if (
                !telegram_id ||
                !wallet_address
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "telegram_id and wallet_address required"

                    });

            }


            const user =
                getUserByTelegramId(
                    telegram_id
                );


            if (!user) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "User not found"

                    });

            }


            /*
             * Simpan wallet.
             */

            db.prepare(`
                UPDATE users

                SET
                    wallet_address = ?,

                    wallet_connected = 1,

                    updated_at =
                        CURRENT_TIMESTAMP

                WHERE id = ?
            `).run(

                wallet_address,

                user.id

            );


            /*
             * Reward Connect Wallet
             * hanya sekali.
             */

            let reward = 0;


            if (
                !user.connect_reward_claimed
            ) {

                reward =
                    CONNECT_WALLET_REWARD;


                db.prepare(`
                    UPDATE users

                    SET
                        connect_reward_claimed = 1

                    WHERE id = ?
                `).run(
                    user.id
                );


                addReward(

                    user.id,

                    "connect_wallet",

                    reward,

                    "Connect Wallet Reward"

                );

            }


            res.json({

                success: true,

                wallet_connected: true,

                reward

            });


        } catch (error) {

            console.error(error);


            res.status(500).json({

                success: false,

                message:
                    "Wallet connection failed"

            });

        }

    }
);


/* =========================================================
   VERIFY TGR HODL
========================================================= */

app.post(
    "/api/wallet/verify",
    async (req, res) => {

        try {

            const {

                telegram_id,

                wallet_address

            } = req.body;


            if (
                !telegram_id ||
                !wallet_address
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "telegram_id and wallet_address required"

                    });

            }


            const user =
                getUserByTelegramId(
                    telegram_id
                );


            if (!user) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "User not found"

                    });

            }


            /*
             * LIVE blockchain check.
             */

            const balance =
                await getTGRBalance(
                    wallet_address
                );


            const eligible =
                balance >=
                MINIMUM_HODL;


            db.prepare(`
                UPDATE users

                SET
                    wallet_address = ?,

                    wallet_connected = 1,

                    hodl_balance = ?,

                    hodl_verified = ?,

                    updated_at =
                        CURRENT_TIMESTAMP

                WHERE id = ?
            `).run(

                wallet_address,

                balance,

                eligible ? 1 : 0,

                user.id

            );


            res.json({

                success: true,

                wallet_address,

                tgr_balance:
                    balance,

                minimum_hodl:
                    MINIMUM_HODL,

                eligible,

                mining_allowed:
                    eligible

            });


        } catch (error) {

            console.error(
                "HODL verification:",
                error
            );


            res.status(500).json({

                success: false,

                message:
                    "Unable to verify TGR balance"

            });

        }

    }
);


/* =========================================================
   START MINING
========================================================= */

app.post(
    "/api/mining/start",
    async (req, res) => {

        try {

            const {
                telegram_id
            } = req.body;


            const user =
                getUserByTelegramId(
                    telegram_id
                );


            if (!user) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "User not found"

                    });

            }


            if (
                !user.wallet_connected ||
                !user.wallet_address
            ) {

                return res
                    .status(403)
                    .json({

                        success: false,

                        message:
                            "Connect TON wallet first"

                    });

            }


            /*
             * Cek blockchain lagi.
             */

            const liveBalance =
                await getTGRBalance(
                    user.wallet_address
                );


            const eligible =
                liveBalance >=
                MINIMUM_HODL;


            db.prepare(`
                UPDATE users

                SET
                    hodl_balance = ?,

                    hodl_verified = ?,

                    updated_at =
                        CURRENT_TIMESTAMP

                WHERE id = ?
            `).run(

                liveBalance,

                eligible ? 1 : 0,

                user.id

            );


            if (!eligible) {

                return res
                    .status(403)
                    .json({

                        success: false,

                        mining: false,

                        message:
                            "Minimum 10,000 TGR HODL required",

                        tgr_balance:
                            liveBalance,

                        minimum_hodl:
                            MINIMUM_HODL

                    });

            }


            if (user.mining_active) {

                return res.json({

                    success: true,

                    mining: true,

                    message:
                        "Mining already active",

                    tgr_balance:
                        liveBalance

                });

            }


            const now =
                new Date()
                    .toISOString();


            const transaction =
                db.transaction(() => {

                    db.prepare(`
                        UPDATE users

                        SET
                            mining_active = 1,

                            mining_started_at = ?,

                            updated_at =
                                CURRENT_TIMESTAMP

                        WHERE id = ?
                    `).run(

                        now,

                        user.id

                    );


                    db.prepare(`
                        INSERT INTO mining_sessions
                        (
                            user_id,
                            started_at
                        )

                        VALUES (?, ?)
                    `).run(

                        user.id,

                        now

                    );

                });


            transaction();


            res.json({

                success: true,

                mining: true,

                started_at:
                    now,

                tgr_balance:
                    liveBalance,

                minimum_hodl:
                    MINIMUM_HODL

            });


        } catch (error) {

            console.error(error);


            res.status(500).json({

                success: false,

                message:
                    "Unable to start mining"

            });

        }

    }
);


/* =========================================================
   MINING STATUS
========================================================= */

app.get(
    "/api/mining/:telegram_id",
    (req, res) => {

        const user =
            getUserByTelegramId(
                req.params.telegram_id
            );


        if (!user) {

            return res
                .status(404)
                .json({

                    success: false,

                    message:
                        "User not found"

                });

        }


        let miningReward = 0;


        if (
            user.mining_active &&
            user.mining_started_at
        ) {

            const start =
                new Date(
                    user.mining_started_at
                ).getTime();


            const now =
                Date.now();


            const seconds =
                Math.max(
                    0,
                    Math.floor(
                        (now - start) /
                        1000
                    )
                );


            miningReward =
                seconds *
                MINING_RATE_PER_SECOND;

        }


        res.json({

            success: true,

            mining_active:
                Boolean(
                    user.mining_active
                ),

            mining_started_at:
                user.mining_started_at,

            mining_reward:
                Number(
                    miningReward.toFixed(6)
                ),

            balance_tgr:
                user.balance_tgr,

            hodl_balance:
                user.hodl_balance,

            minimum_hodl:
                MINIMUM_HODL

        });

    }
);


/* =========================================================
   CLAIM MINING
========================================================= */

app.post(
    "/api/mining/claim",
    (req, res) => {

        try {

            const {
                telegram_id
            } = req.body;


            const user =
                getUserByTelegramId(
                    telegram_id
                );


            if (!user) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "User not found"

                    });

            }


            if (
                !user.mining_active ||
                !user.mining_started_at
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "Mining is not active"

                    });

            }


            const start =
                new Date(
                    user.mining_started_at
                ).getTime();


            const now =
                Date.now();


            const seconds =
                Math.max(
                    0,
                    Math.floor(
                        (now - start) /
                        1000
                    )
                );


            const reward =
                Number(
                    (
                        seconds *
                        MINING_RATE_PER_SECOND
                    ).toFixed(6)
                );


            if (reward <= 0) {

                return res.json({

                    success: true,

                    reward: 0,

                    message:
                        "No mining reward yet"

                });

            }


            const transaction =
                db.transaction(() => {

                    db.prepare(`
                        UPDATE users

                        SET
                            mining_active = 0,

                            mining_started_at = NULL,

                            balance_tgr =
                                balance_tgr + ?,

                            updated_at =
                                CURRENT_TIMESTAMP

                        WHERE id = ?
                    `).run(

                        reward,

                        user.id

                    );


                    db.prepare(`
                        UPDATE mining_sessions

                        SET
                            ended_at = ?,

                            reward_tgr = ?,

                            active = 0

                        WHERE user_id = ?

                        AND active = 1
                    `).run(

                        new Date()
                            .toISOString(),

                        reward,

                        user.id

                    );


                    db.prepare(`
                        INSERT INTO reward_transactions
                        (
                            user_id,
                            type,
                            amount_tgr,
                            description
                        )

                        VALUES (?, ?, ?, ?)
                    `).run(

                        user.id,

                        "mining",

                        reward,

                        "Matrix Mining Reward"

                    );

                });


            transaction();


            res.json({

                success: true,

                reward,

                message:
                    "Mining reward claimed"

            });


        } catch (error) {

            console.error(error);


            res.status(500).json({

                success: false,

                message:
                    "Mining claim failed"

            });

        }

    }
);


/* =========================================================
   REFERRAL
========================================================= */

app.get(
    "/api/referral/:telegram_id",
    (req, res) => {

        const user =
            getUserByTelegramId(
                req.params.telegram_id
            );


        if (!user) {

            return res
                .status(404)
                .json({

                    success: false,

                    message:
                        "User not found"

                });

        }


        const result =
            db.prepare(`
                SELECT
                    COUNT(*) AS total
                FROM referrals
                WHERE referrer_id = ?
            `).get(
                user.id
            );


        res.json({

            success: true,

            referral_code:
                user.referral_code,

            referral_link:
                `https://t.me/${TGRAM_BOT_USERNAME}?start=${user.referral_code}`,

            total_referrals:
                result.total,

            reward_per_referral:
                REFERRAL_REWARD

        });

    }
);


/* =========================================================
   REFERRAL LIST
========================================================= */

app.get(
    "/api/referrals/:telegram_id",
    (req, res) => {

        const user =
            getUserByTelegramId(
                req.params.telegram_id
            );


        if (!user) {

            return res
                .status(404)
                .json({

                    success: false,

                    message:
                        "User not found"

                });

        }


        const referrals =
            db.prepare(`
                SELECT

                    u.username,

                    u.first_name,

                    r.reward_tgr,

                    r.rewarded,

                    r.created_at

                FROM referrals r

                JOIN users u
                    ON u.id =
                    r.referred_user_id

                WHERE r.referrer_id = ?

                ORDER BY
                    r.created_at DESC
            `).all(
                user.id
            );


        res.json({

            success: true,

            referrals

        });

    }
);


/* =========================================================
   REFERRAL REWARD
========================================================= */

app.post(
    "/api/referral/claim",
    (req, res) => {

        try {

            const {
                telegram_id
            } = req.body;


            const user =
                getUserByTelegramId(
                    telegram_id
                );


            if (!user) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "User not found"

                    });

            }


            const pending =
                db.prepare(`
                    SELECT *

                    FROM referrals

                    WHERE referrer_id = ?

                    AND rewarded = 0
                `).all(
                    user.id
                );


            if (!pending.length) {

                return res.json({

                    success: true,

                    reward: 0,

                    message:
                        "No referral reward available"

                });

            }


            const totalReward =
                pending.length *
                REFERRAL_REWARD;


            const transaction =
                db.transaction(() => {

                    for (
                        const referral
                        of pending
                    ) {

                        db.prepare(`
                            UPDATE referrals

                            SET
                                rewarded = 1

                            WHERE id = ?
                        `).run(
                            referral.id
                        );

                    }


                    addReward(

                        user.id,

                        "referral",

                        totalReward,

                        `Referral reward for ${pending.length} user(s)`

                    );

                });


            transaction();


            res.json({

                success: true,

                reward:
                    totalReward,

                referrals:
                    pending.length

            });


        } catch (error) {

            console.error(error);


            res.status(500).json({

                success: false,

                message:
                    "Referral claim failed"

            });

        }

    }
);


/* =========================================================
   TASK LIST
========================================================= */

app.get(
    "/api/tasks/:telegram_id",
    (req, res) => {

        const user =
            getUserByTelegramId(
                req.params.telegram_id
            );


        if (!user) {

            return res
                .status(404)
                .json({

                    success: false,

                    message:
                        "User not found"

                });

        }


        const tasks =
            db.prepare(`
                SELECT

                    t.id,

                    t.task_key,

                    t.title,

                    t.reward_tgr,

                    t.enabled,

                    COALESCE(
                        ut.completed,
                        0
                    ) AS completed

                FROM tasks t

                LEFT JOIN user_tasks ut

                    ON ut.task_id = t.id

                    AND ut.user_id = ?

                WHERE t.enabled = 1

                ORDER BY t.id ASC
            `).all(
                user.id
            );


        res.json({

            success: true,

            tasks

        });

    }
);


/* =========================================================
   JOIN GROUP TASK
========================================================= */

app.post(
    "/api/tasks/join-group",
    (req, res) => {

        try {

            const {
                telegram_id
            } = req.body;


            const user =
                getUserByTelegramId(
                    telegram_id
                );


            if (!user) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "User not found"

                    });

            }


            const task =
                db.prepare(`
                    SELECT *

                    FROM tasks

                    WHERE task_key =
                        'join_group'
                `).get();


            if (!task) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "Task not found"

                    });

            }


            const existing =
                db.prepare(`
                    SELECT *

                    FROM user_tasks

                    WHERE user_id = ?

                    AND task_id = ?
                `).get(

                    user.id,

                    task.id

                );


            if (
                existing &&
                existing.completed
            ) {

                return res.json({

                    success: true,

                    completed: true,

                    reward: 0,

                    message:
                        "Task already completed"

                });

            }


            /*
             * Catatan:
             *
             * Endpoint ini menandai task selesai
             * setelah frontend memanggilnya.
             *
             * Untuk production, verifikasi membership
             * Telegram harus dilakukan menggunakan
             * Bot API + bot yang menjadi member/admin group.
             */


            db.prepare(`
                INSERT INTO user_tasks
                (
                    user_id,
                    task_id,
                    completed,
                    completed_at
                )

                VALUES (?, ?, 1, ?)

                ON CONFLICT(user_id, task_id)

                DO UPDATE SET

                    completed = 1,

                    completed_at = excluded.completed_at
            `).run(

                user.id,

                task.id,

                new Date()
                    .toISOString()

            );


            addReward(

                user.id,

                "join_group",

                task.reward_tgr,

                "Join TGram Group Reward"

            );


            db.prepare(`
                UPDATE users

                SET
                    group_joined = 1,

                    updated_at =
                        CURRENT_TIMESTAMP

                WHERE id = ?
            `).run(
                user.id
            );


            res.json({

                success: true,

                completed: true,

                reward:
                    task.reward_tgr,

                group:
                    TGRAM_GROUP

            });


        } catch (error) {

            console.error(error);


            res.status(500).json({

                success: false,

                message:
                    "Task failed"

            });

        }

    }
);


/* =========================================================
   BALANCE
========================================================= */

app.get(
    "/api/balance/:telegram_id",
    (req, res) => {

        const user =
            getUserByTelegramId(
                req.params.telegram_id
            );


        if (!user) {

            return res
                .status(404)
                .json({

                    success: false,

                    message:
                        "User not found"

                });

        }


        res.json({

            success: true,

            balance_tgr:
                user.balance_tgr,

            hodl_balance:
                user.hodl_balance,

            wallet_connected:
                Boolean(
                    user.wallet_connected
                ),

            mining_active:
                Boolean(
                    user.mining_active
                )

        });

    }
);


/* =========================================================
   REWARD HISTORY
========================================================= */

app.get(
    "/api/rewards/:telegram_id",
    (req, res) => {

        const user =
            getUserByTelegramId(
                req.params.telegram_id
            );


        if (!user) {

            return res
                .status(404)
                .json({

                    success: false,

                    message:
                        "User not found"

                });

        }


        const rewards =
            db.prepare(`
                SELECT

                    type,

                    amount_tgr,

                    description,

                    created_at

                FROM reward_transactions

                WHERE user_id = ?

                ORDER BY
                    created_at DESC

                LIMIT 100
            `).all(
                user.id
            );


        res.json({

            success: true,

            rewards

        });

    }
);


/* =========================================================
   SERVER
========================================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "================================"
        );

        console.log(
            "TGram Backend"
        );

        console.log(
            "Status: ONLINE"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            "Database: SQLite"
        );

        console.log(
            `Minimum HODL: ${MINIMUM_HODL} TGR`
        );

        console.log(
            "================================"
        );

    }
);
