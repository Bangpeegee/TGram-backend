CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,

    telegram_id BIGINT UNIQUE NOT NULL,

    username TEXT,
    first_name TEXT,
    last_name TEXT,

    wallet_address TEXT UNIQUE,

    referral_code TEXT UNIQUE NOT NULL,
    referred_by BIGINT REFERENCES users(id),

    reward_balance NUMERIC(30,9) NOT NULL DEFAULT 0,

    wallet_reward_claimed BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS mining_sessions (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stopped_at TIMESTAMPTZ,

    last_claim_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    active BOOLEAN NOT NULL DEFAULT TRUE,

    total_earned NUMERIC(30,9) NOT NULL DEFAULT 0
);


CREATE INDEX IF NOT EXISTS mining_user_idx
ON mining_sessions(user_id);


CREATE INDEX IF NOT EXISTS mining_active_idx
ON mining_sessions(active);


CREATE TABLE IF NOT EXISTS referrals (
    id BIGSERIAL PRIMARY KEY,

    referrer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    referred_user_id BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    reward_amount NUMERIC(30,9) NOT NULL DEFAULT 5000,

    rewarded BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS task_completions (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    task_key TEXT NOT NULL,

    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(user_id, task_key)
);


CREATE TABLE IF NOT EXISTS ton_nonces (
    id BIGSERIAL PRIMARY KEY,

    nonce TEXT UNIQUE NOT NULL,

    telegram_id BIGINT,

    expires_at TIMESTAMPTZ NOT NULL,

    used BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS ton_nonce_idx
ON ton_nonces(nonce);


CREATE TABLE IF NOT EXISTS reward_transactions (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    type TEXT NOT NULL,

    amount NUMERIC(30,9) NOT NULL,

    reference TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
