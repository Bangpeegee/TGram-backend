CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,

    telegram_id BIGINT UNIQUE NOT NULL,

    username TEXT,
    first_name TEXT,

    wallet_address TEXT UNIQUE,

    balance_tgr NUMERIC(30,9) DEFAULT 0,

    referral_code TEXT UNIQUE NOT NULL,
    referred_by BIGINT REFERENCES users(id),

    wallet_connected BOOLEAN DEFAULT FALSE,
    connect_reward_claimed BOOLEAN DEFAULT FALSE,

    hodl_balance NUMERIC(30,9) DEFAULT 0,
    hodl_verified BOOLEAN DEFAULT FALSE,

    group_joined BOOLEAN DEFAULT FALSE,

    mining_active BOOLEAN DEFAULT FALSE,
    mining_started_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS mining_sessions (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    ended_at TIMESTAMPTZ,

    reward_tgr NUMERIC(30,9) DEFAULT 0,

    active BOOLEAN DEFAULT TRUE
);


CREATE TABLE IF NOT EXISTS referrals (
    id BIGSERIAL PRIMARY KEY,

    referrer_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    referred_user_id BIGINT UNIQUE NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    reward_tgr NUMERIC(30,9) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS reward_transactions (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    type TEXT NOT NULL,

    amount_tgr NUMERIC(30,9) NOT NULL,

    description TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS tasks (
    id BIGSERIAL PRIMARY KEY,

    task_key TEXT UNIQUE NOT NULL,

    title TEXT NOT NULL,

    reward_tgr NUMERIC(30,9) DEFAULT 0,

    enabled BOOLEAN DEFAULT TRUE
);


CREATE TABLE IF NOT EXISTS user_tasks (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    task_id BIGINT NOT NULL
        REFERENCES tasks(id)
        ON DELETE CASCADE,

    completed BOOLEAN DEFAULT FALSE,

    completed_at TIMESTAMPTZ,

    UNIQUE(user_id, task_id)
);


CREATE INDEX IF NOT EXISTS idx_users_telegram
ON users(telegram_id);

CREATE INDEX IF NOT EXISTS idx_users_referral
ON users(referral_code);

CREATE INDEX IF NOT EXISTS idx_mining_user
ON mining_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_rewards_user
ON reward_transactions(user_id);
INSERT INTO tasks
(task_key, title, reward_tgr)
VALUES
(
    'join_group',
    'Join TGram Group',
    500
)
ON CONFLICT (task_key) DO NOTHING;
