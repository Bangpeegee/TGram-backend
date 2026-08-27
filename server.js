import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import pg from "pg";

import {
  Address,
  Cell,
  contractAddress,
  loadStateInit,
  domainSignVerify
} from "@ton/ton";

import { sha256 } from "@ton/crypto";

dotenv.config();

const { Pool } = pg;

const app = express();

const PORT = Number(process.env.PORT || 3000);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});


/* =========================================================
   CONFIG
========================================================= */

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  "https://bangpeegee.github.io";

const JWT_SECRET =
  process.env.JWT_SECRET;

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const TELEGRAM_GROUP_ID =
  process.env.TELEGRAM_GROUP_ID;

const TONCENTER_API_KEY =
  process.env.TONCENTER_API_KEY;

const TGR_JETTON_MASTER =
  process.env.TGR_JETTON_MASTER ||
  "EQDymqX9ZyAl_XRi_PefRsQkzwhirepe95ibUS_lB-9gc66z";

const TGR_DECIMALS =
  Number(process.env.TGR_DECIMALS || 9);

const MIN_HODL =
  Number(process.env.MIN_HODL_TGR || 10000);

const CONNECT_REWARD =
  Number(process.env.CONNECT_WALLET_REWARD || 1000);

const REFERRAL_REWARD =
  Number(process.env.REFERRAL_REWARD || 5000);

const MINING_RATE =
  Number(process.env.MINING_TGR_PER_MINUTE || 1);

const MAX_MINING_HOURS =
  Number(process.env.MAX_MINING_HOURS || 24);

const TON_DOMAIN =
  process.env.TON_CONNECT_DOMAIN ||
  "bangpeegee.github.io";


/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors({
  origin: true,
  credentials: false
}));

app.use(express.json({
  limit: "1mb"
}));


/* =========================================================
   BASIC
========================================================= */

app.get("/", (req, res) => {

  res.json({
    ok: true,
    project: "TGram",
    service: "TGram Backend",
    version: "1.0.0"
  });

});


app.get("/health", async (req, res) => {

  try {

    await pool.query("SELECT 1");

    res.json({
      ok: true,
      database: "connected"
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      ok: false,
      database: "error"
    });

  }

});


/* =========================================================
   DATABASE HELPER
========================================================= */

async function query(text, params = []) {

  return pool.query(text, params);

}


/* =========================================================
   TELEGRAM INIT DATA VERIFICATION
========================================================= */

function verifyTelegramInitData(initData) {

  if (!initData) {
    throw new Error("Missing Telegram initData");
  }

  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  const params = new URLSearchParams(initData);

  const receivedHash =
    params.get("hash");

  if (!receivedHash) {
    throw new Error("Telegram hash missing");
  }

  params.delete("hash");

  const dataCheckString =
    [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

  const secretKey =
    crypto
      .createHmac("sha256", "WebAppData")
      .update(TELEGRAM_BOT_TOKEN)
      .digest();

  const calculatedHash =
    crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

  if (
    calculatedHash.length !==
    receivedHash.length
  ) {
    throw new Error("Invalid Telegram signature");
  }

  const valid =
    crypto.timingSafeEqual(
      Buffer.from(calculatedHash, "hex"),
      Buffer.from(receivedHash, "hex")
    );

  if (!valid) {
    throw new Error("Invalid Telegram initData");
  }

  const authDate =
    Number(params.get("auth_date"));

  if (!authDate) {
    throw new Error("Missing auth_date");
  }

  const age =
    Math.floor(Date.now() / 1000) -
    authDate;

  if (age > 86400) {
    throw new Error("Telegram session expired");
  }

  const userString =
    params.get("user");

  if (!userString) {
    throw new Error("Telegram user missing");
  }

  return JSON.parse(userString);
}


/* =========================================================
   JWT
========================================================= */

function createSession(userId) {

  return jwt.sign(
    {
      userId
    },
    JWT_SECRET,
    {
      expiresIn: "30d"
    }
  );

}


function verifyJWT(req, res, next) {

  try {

    const header =
      req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const token =
      header.substring(7);

    const decoded =
      jwt.verify(
        token,
        JWT_SECRET
      );

    req.auth = decoded;

    next();

  } catch {

    return res.status(401).json({
      error: "Invalid session"
    });

  }

}


/* =========================================================
   REFERRAL CODE
========================================================= */

function generateReferralCode() {

  return (
    "TGR-" +
    crypto
      .randomBytes(5)
      .toString("hex")
      .toUpperCase()
  );

}


async function createUniqueReferralCode() {

  for (;;) {

    const code =
      generateReferralCode();

    const result =
      await query(
        `
        SELECT id
        FROM users
        WHERE referral_code = $1
        `,
        [code]
      );

    if (result.rowCount === 0) {
      return code;
    }

  }

}


/* =========================================================
   GET OR CREATE USER
========================================================= */

async function getOrCreateUser(
  telegramUser,
  referralCode = null
) {

  const telegramId =
    Number(telegramUser.id);

  let result =
    await query(
      `
      SELECT *
      FROM users
      WHERE telegram_id = $1
      `,
      [telegramId]
    );

  if (result.rowCount) {

    return result.rows[0];

  }

  const referralCodeNew =
    await createUniqueReferralCode();

  let referredBy = null;

  if (referralCode) {

    const ref =
      await query(
        `
        SELECT id
        FROM users
        WHERE referral_code = $1
        `,
        [referralCode]
      );

    if (
      ref.rowCount &&
      Number(ref.rows[0].id) !== telegramId
    ) {

      referredBy =
        ref.rows[0].id;

    }

  }

  result =
    await query(
      `
      INSERT INTO users
      (
        telegram_id,
        username,
        first_name,
        last_name,
        referral_code,
        referred_by
      )
      VALUES
      ($1,$2,$3,$4,$5,$6)
      RETURNING *
      `,
      [
        telegramId,
        telegramUser.username || null,
        telegramUser.first_name || null,
        telegramUser.last_name || null,
        referralCodeNew,
        referredBy
      ]
    );

  const user =
    result.rows[0];


  /* Referral record */

  if (referredBy) {

    await query(
      `
      INSERT INTO referrals
      (
        referrer_id,
        referred_user_id,
        reward_amount
      )
      VALUES ($1,$2,$3)
      ON CONFLICT DO NOTHING
      `,
      [
        referredBy,
        user.id,
        REFERRAL_REWARD
      ]
    );

  }

  return user;

}


/* =========================================================
   LOGIN
========================================================= */

app.post(
  "/api/auth/telegram",
  async (req, res) => {

    try {

      const {
        initData,
        referralCode
      } = req.body;

      const telegramUser =
        verifyTelegramInitData(
          initData
        );

      const user =
        await getOrCreateUser(
          telegramUser,
          referralCode
        );

      const token =
        createSession(user.id);

      res.json({
        ok: true,
        token,
        user: {
          id: user.id,
          telegramId: user.telegram_id,
          username: user.username,
          referralCode: user.referral_code,
          rewardBalance: user.reward_balance,
          walletAddress: user.wallet_address
        }
      });

    } catch (error) {

      console.error(error);

      res.status(400).json({
        ok: false,
        error: error.message
      });

    }

  }
);


/* =========================================================
   USER
========================================================= */

app.get(
  "/api/user",
  verifyJWT,
  async (req, res) => {

    try {

      const result =
        await query(
          `
          SELECT
            id,
            telegram_id,
            username,
            first_name,
            last_name,
            wallet_address,
            referral_code,
            reward_balance,
            wallet_reward_claimed,
            created_at
          FROM users
          WHERE id = $1
          `,
          [req.auth.userId]
        );

      if (!result.rowCount) {

        return res.status(404).json({
          error: "User not found"
        });

      }

      res.json({
        ok: true,
        user: result.rows[0]
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Server error"
      });

    }

  }
);


/* =========================================================
   TON NONCE
========================================================= */

app.post(
  "/api/tonproof/nonce",
  verifyJWT,
  async (req, res) => {

    try {

      const nonce =
        crypto.randomBytes(32).toString("hex");

      await query(
        `
        INSERT INTO ton_nonces
        (
          nonce,
          telegram_id,
          expires_at
        )
        VALUES
        ($1,
         (
           SELECT telegram_id
           FROM users
           WHERE id = $2
         ),
         NOW() + INTERVAL '10 minutes'
        )
        `,
        [
          nonce,
          req.auth.userId
        ]
      );

      res.json({
        ok: true,
        nonce
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Could not create nonce"
      });

    }

  }
);


/* =========================================================
   TON PROOF DIGEST
========================================================= */

async function buildTonProofDigest(
  addressString,
  proof
) {

  const address =
    Address.parse(addressString);

  const domain =
    proof.domain.value;

  const domainBytes =
    Buffer.from(domain, "utf8");

  if (
    proof.domain.lengthBytes !==
    domainBytes.length
  ) {

    throw new Error(
      "Invalid domain length"
    );

  }

  const workchain =
    Buffer.alloc(4);

  workchain.writeInt32BE(
    address.workChain
  );

  const domainLength =
    Buffer.alloc(4);

  domainLength.writeUInt32LE(
    domainBytes.length
  );

  const timestamp =
    Buffer.alloc(8);

  timestamp.writeBigUInt64LE(
    BigInt(proof.timestamp)
  );

  const message =
    Buffer.concat([
      Buffer.from(
        "ton-proof-item-v2/"
      ),

      workchain,

      address.hash,

      domainLength,

      domainBytes,

      timestamp,

      Buffer.from(
        proof.payload,
        "utf8"
      )
    ]);

  const messageHash =
    await sha256(message);

  const fullMessage =
    Buffer.concat([
      Buffer.from([0xff, 0xff]),

      Buffer.from(
        "ton-connect"
      ),

      messageHash
    ]);

  return sha256(fullMessage);

}


/* =========================================================
   TON PROOF VERIFICATION
========================================================= */

app.post(
  "/api/tonproof/verify",
  verifyJWT,
  async (req, res) => {

    try {

      const {
        address,
        network,
        walletStateInit,
        proof
      } = req.body;

      if (
        !address ||
        !walletStateInit ||
        !proof
      ) {

        return res.status(400).json({
          error: "Incomplete TON proof"
        });

      }


      /* Network */

      if (
        String(network) !==
        String(process.env.TON_NETWORK || "-239")
      ) {

        return res.status(400).json({
          error: "Wrong TON network"
        });

      }


      /* Domain */

      if (
        proof.domain?.value !==
        TON_DOMAIN
      ) {

        return res.status(400).json({
          error: "Wrong TON Connect domain"
        });

      }


      /* Timestamp */

      const now =
        Math.floor(
          Date.now() / 1000
        );

      if (
        Math.abs(
          now -
          Number(proof.timestamp)
        ) > 900
      ) {

        return res.status(400).json({
          error: "TON proof expired"
        });

      }


      /* Nonce */

      const nonceResult =
        await query(
          `
          SELECT *
          FROM ton_nonces
          WHERE nonce = $1
            AND used = false
            AND expires_at > NOW()
            AND telegram_id = (
              SELECT telegram_id
              FROM users
              WHERE id = $2
            )
          FOR UPDATE
          `,
          [
            proof.payload,
            req.auth.userId
          ]
        );

      if (!nonceResult.rowCount) {

        return res.status(400).json({
          error: "Invalid or already used nonce"
        });

      }


      /* StateInit */

      const stateInit =
        loadStateInit(
          Cell
            .fromBase64(walletStateInit)
            .beginParse()
        );

      const wantedAddress =
        Address.parse(address);

      const derivedAddress =
        contractAddress(
          wantedAddress.workChain,
          stateInit
        );

      if (
        !derivedAddress.equals(
          wantedAddress
        )
      ) {

        return res.status(400).json({
          error:
            "Wallet state does not match address"
        });

      }


      /*
       * For production wallet authentication,
       * the public key must be derived from
       * walletStateInit or retrieved through
       * get_public_key.
       *
       * The connected wallet's publicKey is NOT
       * trusted by this backend.
       */

      if (!TONCENTER_API_KEY) {

        return res.status(500).json({
          error:
            "TONCENTER_API_KEY is required for wallet proof verification"
        });

      }


      const publicKey =
        await getWalletPublicKey(
          address
        );

      if (!publicKey) {

        return res.status(400).json({
          error:
            "Could not resolve wallet public key"
        });

      }


      const digest =
        await buildTonProofDigest(
          address,
          proof
        );


      const signature =
        Buffer.from(
          proof.signature,
          "base64"
        );


      const valid =
        domainSignVerify({
          data: digest,
          signature,
          publicKey,
          domain: {
            type: "empty"
          }
        });


      if (!valid) {

        return res.status(400).json({
          error: "Invalid TON proof signature"
        });

      }


      /* Consume nonce */

      await query(
        `
        UPDATE ton_nonces
        SET used = true
        WHERE nonce = $1
        `,
        [proof.payload]
      );


      /* Save wallet */

      await query(
        `
        UPDATE users
        SET
          wallet_address = $1,
          updated_at = NOW()
        WHERE id = $2
        `,
        [
          address,
          req.auth.userId
        ]
      );


      res.json({
        ok: true,
        verified: true,
        walletAddress: address
      });

    } catch (error) {

      console.error(error);

      res.status(400).json({
        ok: false,
        error: error.message
      });

    }

  }
);


/* =========================================================
   TON PUBLIC KEY
========================================================= */

async function getWalletPublicKey(
  address
) {

  const url =
    "https://toncenter.com/api/v2/runGetMethod";

  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "X-API-Key":
            TONCENTER_API_KEY
        },

        body: JSON.stringify({
          address,
          method: "get_public_key",
          stack: []
        })
      }
    );

  if (!response.ok) {
    return null;
  }

  const data =
    await response.json();

  if (
    !data.ok ||
    !data.result?.stack?.length
  ) {

    return null;

  }

  const item =
    data.result.stack[0];

  /*
   * Toncenter can return the integer
   * as a hexadecimal value.
   */

  if (
    item.type === "num" &&
    typeof item.value === "string"
  ) {

    let hex =
      item.value
        .replace(/^0x/, "")
        .replace(/^0+/, "");

    if (hex.length % 2) {
      hex = "0" + hex;
    }

    hex =
      hex.padStart(64, "0");

    return Buffer.from(
      hex,
      "hex"
    );

  }

  return null;
}


/* =========================================================
   TGR BALANCE
========================================================= */

async function getTGRBalance(
  ownerAddress
) {

  const params =
    new URLSearchParams();

  params.append(
    "owner_address",
    ownerAddress
  );

  params.append(
    "jetton_address",
    TGR_JETTON_MASTER
  );

  params.append(
    "limit",
    "1"
  );


  const response =
    await fetch(
      `https://toncenter.com/api/v3/jetton/wallets?${params.toString()}`,
      {
        headers: {
          "X-API-Key":
            TONCENTER_API_KEY
        }
      }
    );


  if (!response.ok) {

    const text =
      await response.text();

    throw new Error(
      `TON API error: ${text}`
    );

  }


  const data =
    await response.json();


  const wallet =
    data.jetton_wallets?.[0];


  if (!wallet) {
    return 0;
  }


  return (
    Number(wallet.balance) /
    Math.pow(
      10,
      TGR_DECIMALS
    )
  );

}


/* =========================================================
   HODL CHECK
========================================================= */

app.get(
  "/api/wallet/balance",
  verifyJWT,
  async (req, res) => {

    try {

      const result =
        await query(
          `
          SELECT wallet_address
          FROM users
          WHERE id = $1
          `,
          [req.auth.userId]
        );

      if (!result.rowCount) {

        return res.status(404).json({
          error: "User not found"
        });

      }

      const address =
        result.rows[0].wallet_address;

      if (!address) {

        return res.json({
          ok: true,
          connected: false,
          balance: 0,
          eligible: false
        });

      }

      const balance =
        await getTGRBalance(
          address
        );

      res.json({
        ok: true,
        connected: true,
        walletAddress: address,
        balance,
        minimum: MIN_HODL,
        eligible:
          balance >= MIN_HODL
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Could not read TGR balance"
      });

    }

  }
);


/* =========================================================
   CONNECT WALLET REWARD
========================================================= */

app.post(
  "/api/reward/connect-wallet",
  verifyJWT,
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      await client.query("BEGIN");


      const userResult =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE id = $1
          FOR UPDATE
          `,
          [req.auth.userId]
        );


      if (!userResult.rowCount) {

        throw new Error(
          "User not found"
        );

      }


      const user =
        userResult.rows[0];


      if (!user.wallet_address) {

        throw new Error(
          "Wallet is not verified"
        );

      }


      if (
        user.wallet_reward_claimed
      ) {

        await client.query(
          "COMMIT"
        );

        return res.json({
          ok: true,
          claimed: false,
          message:
            "Wallet reward already claimed"
        });

      }


      await client.query(
        `
        UPDATE users
        SET
          reward_balance =
            reward_balance + $1,
          wallet_reward_claimed = true,
          updated_at = NOW()
        WHERE id = $2
        `,
        [
          CONNECT_REWARD,
          req.auth.userId
        ]
      );


      await client.query(
        `
        INSERT INTO reward_transactions
        (
          user_id,
          type,
          amount,
          reference
        )
        VALUES
        ($1,$2,$3,$4)
        `,
        [
          req.auth.userId,
          "CONNECT_WALLET",
          CONNECT_REWARD,
          "wallet-connect"
        ]
      );


      await client.query(
        "COMMIT"
      );


      res.json({
        ok: true,
        claimed: true,
        reward: CONNECT_REWARD
      });

    } catch (error) {

      await client.query(
        "ROLLBACK"
      );

      console.error(error);

      res.status(400).json({
        error: error.message
      });

    } finally {

      client.release();

    }

  }
);


/* =========================================================
   START MINING
========================================================= */

app.post(
  "/api/mining/start",
  verifyJWT,
  async (req, res) => {

    try {

      const userResult =
        await query(
          `
          SELECT wallet_address
          FROM users
          WHERE id = $1
          `,
          [req.auth.userId]
        );

      if (!userResult.rowCount) {

        return res.status(404).json({
          error: "User not found"
        });

      }

      const wallet =
        userResult.rows[0]
          .wallet_address;


      if (!wallet) {

        return res.status(400).json({
          error:
            "Connect and verify your TON wallet first"
        });

      }


      const balance =
        await getTGRBalance(
          wallet
        );


      if (balance < MIN_HODL) {

        return res.status(403).json({
          error:
            `Minimum HODL is ${MIN_HODL} TGR`,
          balance,
          minimum: MIN_HODL
        });

      }


      const active =
        await query(
          `
          SELECT *
          FROM mining_sessions
          WHERE user_id = $1
            AND active = true
          LIMIT 1
          `,
          [req.auth.userId]
        );


      if (active.rowCount) {

        return res.json({
          ok: true,
          mining: true,
          session: active.rows[0]
        });

      }


      const result =
        await query(
          `
          INSERT INTO mining_sessions
          (
            user_id,
            started_at,
            last_claim_at,
            active
          )
          VALUES
          ($1,NOW(),NOW(),true)
          RETURNING *
          `,
          [req.auth.userId]
        );


      res.json({
        ok: true,
        mining: true,
        session: result.rows[0],
        hodlBalance: balance
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not start mining"
      });

    }

  }
);


/* =========================================================
   CLAIM MINING
========================================================= */

app.post(
  "/api/mining/claim",
  verifyJWT,
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      await client.query(
        "BEGIN"
      );


      const sessionResult =
        await client.query(
          `
          SELECT *
          FROM mining_sessions
          WHERE user_id = $1
            AND active = true
          ORDER BY id DESC
          LIMIT 1
          FOR UPDATE
          `,
          [req.auth.userId]
        );


      if (!sessionResult.rowCount) {

        throw new Error(
          "Mining is not active"
        );

      }


      const session =
        sessionResult.rows[0];


      /* HODL check again */

      const userResult =
        await client.query(
          `
          SELECT wallet_address
          FROM users
          WHERE id = $1
          `,
          [req.auth.userId]
        );


      const wallet =
        userResult.rows[0]
          ?.wallet_address;


      if (!wallet) {

        throw new Error(
          "Wallet not connected"
        );

      }


      const hodl =
        await getTGRBalance(
          wallet
        );


      if (hodl < MIN_HODL) {

        throw new Error(
          "HODL requirement no longer satisfied"
        );

      }


      const now =
        Date.now();

      const last =
        new Date(
          session.last_claim_at
        ).getTime();


      let minutes =
        Math.floor(
          (now - last) /
          60000
        );


      if (minutes < 1) {

        await client.query(
          "COMMIT"
        );

        return res.json({
          ok: true,
          earned: 0,
          message:
            "Wait for the next mining interval"
        });

      }


      const maxMinutes =
        MAX_MINING_HOURS * 60;


      minutes =
        Math.min(
          minutes,
          maxMinutes
        );


      const earned =
        minutes *
        MINING_RATE;


      await client.query(
        `
        UPDATE mining_sessions
        SET
          last_claim_at = NOW(),
          total_earned =
            total_earned + $1
        WHERE id = $2
        `,
        [
          earned,
          session.id
        ]
      );


      await client.query(
        `
        UPDATE users
        SET
          reward_balance =
            reward_balance + $1,
          updated_at = NOW()
        WHERE id = $2
        `,
        [
          earned,
          req.auth.userId
        ]
      );


      await client.query(
        `
        INSERT INTO reward_transactions
        (
          user_id,
          type,
          amount,
          reference
        )
        VALUES
        ($1,$2,$3,$4)
        `,
        [
          req.auth.userId,
          "MINING",
          earned,
          `mining-${session.id}`
        ]
      );


      await client.query(
        "COMMIT"
      );


      res.json({
        ok: true,
        earned,
        minutes,
        ratePerMinute:
          MINING_RATE
      });

    } catch (error) {

      await client.query(
        "ROLLBACK"
      );

      console.error(error);

      res.status(400).json({
        error: error.message
      });

    } finally {

      client.release();

    }

  }
);


/* =========================================================
   STOP MINING
========================================================= */

app.post(
  "/api/mining/stop",
  verifyJWT,
  async (req, res) => {

    try {

      const result =
        await query(
          `
          UPDATE mining_sessions
          SET
            active = false,
            stopped_at = NOW()
          WHERE id = (
            SELECT id
            FROM mining_sessions
            WHERE user_id = $1
              AND active = true
            ORDER BY id DESC
            LIMIT 1
          )
          RETURNING *
          `,
          [req.auth.userId]
        );


      res.json({
        ok: true,
        stopped:
          result.rowCount > 0
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Could not stop mining"
      });

    }

  }
);


/* =========================================================
   MINING STATUS
========================================================= */

app.get(
  "/api/mining/status",
  verifyJWT,
  async (req, res) => {

    try {

      const result =
        await query(
          `
          SELECT *
          FROM mining_sessions
          WHERE user_id = $1
          ORDER BY id DESC
          LIMIT 1
          `,
          [req.auth.userId]
        );


      const user =
        await query(
          `
          SELECT
            reward_balance,
            wallet_address
          FROM users
          WHERE id = $1
          `,
          [req.auth.userId]
        );


      res.json({
        ok: true,
        session:
          result.rows[0] || null,
        rewardBalance:
          user.rows[0]?.reward_balance || 0,
        walletAddress:
          user.rows[0]?.wallet_address || null
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Could not load mining status"
      });

    }

  }
);


/* =========================================================
   REFERRAL INFO
========================================================= */

app.get(
  "/api/referral",
  verifyJWT,
  async (req, res) => {

    try {

      const user =
        await query(
          `
          SELECT
            referral_code
          FROM users
          WHERE id = $1
          `,
          [req.auth.userId]
        );


      const stats =
        await query(
          `
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER
              (WHERE rewarded = true)::int
              AS rewarded
          FROM referrals
          WHERE referrer_id = $1
          `,
          [req.auth.userId]
        );


      const code =
        user.rows[0].referral_code;


      res.json({
        ok: true,

        referralCode:
          code,

        referralLink:
          `https://t.me/YOUR_BOT_USERNAME?startapp=${code}`,

        total:
          stats.rows[0].total,

        rewarded:
          stats.rows[0].rewarded,

        rewardPerReferral:
          REFERRAL_REWARD
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not load referral"
      });

    }

  }
);


/* =========================================================
   PROCESS REFERRAL REWARD
========================================================= */

app.post(
  "/api/referral/claim",
  verifyJWT,
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      await client.query(
        "BEGIN"
      );


      const referrals =
        await client.query(
          `
          SELECT *
          FROM referrals
          WHERE referrer_id = $1
            AND rewarded = false
          FOR UPDATE
          `,
          [req.auth.userId]
        );


      let rewarded = 0;


      for (
        const referral of
        referrals.rows
      ) {

        /*
         * Reward is only granted when
         * referred user has a verified wallet.
         */

        const referred =
          await client.query(
            `
            SELECT wallet_address
            FROM users
            WHERE id = $1
            `,
            [referral.referred_user_id]
          );


        if (
          !referred.rows[0]
            ?.wallet_address
        ) {
          continue;
        }


        await client.query(
          `
          UPDATE users
          SET
            reward_balance =
              reward_balance + $1
          WHERE id = $2
          `,
          [
            REFERRAL_REWARD,
            req.auth.userId
          ]
        );


        await client.query(
          `
          UPDATE referrals
          SET rewarded = true
          WHERE id = $1
          `,
          [referral.id]
        );


        await client.query(
          `
          INSERT INTO reward_transactions
          (
            user_id,
            type,
            amount,
            reference
          )
          VALUES
          ($1,$2,$3,$4)
          `,
          [
            req.auth.userId,
            "REFERRAL",
            REFERRAL_REWARD,
            `referral-${referral.id}`
          ]
        );


        rewarded +=
          REFERRAL_REWARD;

      }


      await client.query(
        "COMMIT"
      );


      res.json({
        ok: true,
        rewarded
      });

    } catch (error) {

      await client.query(
        "ROLLBACK"
      );

      console.error(error);

      res.status(500).json({
        error:
          "Could not process referral"
      });

    } finally {

      client.release();

    }

  }
);


/* =========================================================
   TELEGRAM GROUP TASK
========================================================= */

app.get(
  "/api/tasks/group",
  verifyJWT,
  async (req, res) => {

    try {

      const userResult =
        await query(
          `
          SELECT telegram_id
          FROM users
          WHERE id = $1
          `,
          [req.auth.userId]
        );


      const telegramId =
        userResult.rows[0]
          ?.telegram_id;


      const response =
        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(TELEGRAM_GROUP_ID)}&user_id=${telegramId}`
        );


      const data =
        await response.json();


      if (!data.ok) {

        return res.status(400).json({
          error:
            "Telegram membership verification failed",
          telegram:
            data.description
        });

      }


      const status =
        data.result.status;


      const member =
        [
          "creator",
          "administrator",
          "member"
        ].includes(status);


      if (member) {

        await query(
          `
          INSERT INTO task_completions
          (
            user_id,
            task_key
          )
          VALUES ($1,'JOIN_GROUP')
          ON CONFLICT DO NOTHING
          `,
          [req.auth.userId]
        );

      }


      res.json({
        ok: true,
        task: "JOIN_GROUP",
        completed: member,
        status
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not verify group membership"
      });

    }

  }
);


/* =========================================================
   TASK STATUS
========================================================= */

app.get(
  "/api/tasks",
  verifyJWT,
  async (req, res) => {

    try {

      const result =
        await query(
          `
          SELECT task_key, completed_at
          FROM task_completions
          WHERE user_id = $1
          `,
          [req.auth.userId]
        );


      res.json({
        ok: true,
        tasks:
          result.rows
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not load tasks"
      });

    }

  }
);


/* =========================================================
   GLOBAL ERROR
========================================================= */

app.use(
  (err, req, res, next) => {

    console.error(err);

    res.status(500).json({
      error:
        "Internal server error"
    });

  }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      `TGram backend running on port ${PORT}`
    );

  }
);
