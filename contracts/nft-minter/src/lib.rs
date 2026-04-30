#![no_std]

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, symbol_short, Address, Env, String,
    Symbol, Vec,
};

const TOTAL_MINTED: Symbol = symbol_short!("TOTAL");

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Token(u32),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NftToken {
    pub token_id: u32,
    pub owner: Address,
    pub name: String,
    pub description: String,
    pub image: String,
    pub minted_at: u64,
}

#[contractevent(topics = ["NFT", "minted"])]
pub struct MintedEvent {
    pub token_id: u32,
    pub owner: Address,
    pub name: String,
    pub image: String,
    pub minted_at: u64,
}

#[contract]
pub struct NftMinter;

#[contractimpl]
impl NftMinter {
    pub fn mint(
        env: Env,
        owner: Address,
        name: String,
        description: String,
        image: String,
    ) -> u32 {
        owner.require_auth();
        validate_metadata(&name, &description, &image);

        let token_id = next_token_id(&env);
        let token = NftToken {
            token_id,
            owner: owner.clone(),
            name: name.clone(),
            description,
            image: image.clone(),
            minted_at: env.ledger().timestamp(),
        };

        let key = DataKey::Token(token_id);
        env.storage().persistent().set(&key, &token);
        env.storage().persistent().extend_ttl(&key, 1_000, 200_000);
        env.storage().instance().extend_ttl(1_000, 200_000);

        MintedEvent {
            token_id,
            owner,
            name,
            image,
            minted_at: token.minted_at,
        }
        .publish(&env);

        token_id
    }

    pub fn get_total_minted(env: Env) -> u32 {
        env.storage().instance().get(&TOTAL_MINTED).unwrap_or(0)
    }

    pub fn get_token(env: Env, token_id: u32) -> NftToken {
        read_token(&env, token_id)
    }

    pub fn get_recent_tokens(env: Env, limit: u32) -> Vec<NftToken> {
        let total = Self::get_total_minted(env.clone());
        let capped = if limit > total { total } else { limit };
        let mut items = Vec::new(&env);

        if capped == 0 {
            return items;
        }

        let mut remaining = capped;
        let mut cursor = total;

        while remaining > 0 {
            items.push_back(read_token(&env, cursor));
            cursor -= 1;
            remaining -= 1;
        }

        items
    }
}

fn next_token_id(env: &Env) -> u32 {
    let current: u32 = env.storage().instance().get(&TOTAL_MINTED).unwrap_or(0);
    let next = current + 1;
    env.storage().instance().set(&TOTAL_MINTED, &next);
    next
}

fn read_token(env: &Env, token_id: u32) -> NftToken {
    let key = DataKey::Token(token_id);
    env.storage().persistent().extend_ttl(&key, 1_000, 200_000);
    env.storage().persistent().get(&key).unwrap()
}

fn validate_metadata(name: &String, description: &String, image: &String) {
    if name.len() == 0 || name.len() > 48 {
        panic!("name must be between 1 and 48 characters");
    }

    if description.len() == 0 || description.len() > 160 {
        panic!("description must be between 1 and 160 characters");
    }

    if image.len() == 0 || image.len() > 160 {
        panic!("image must be between 1 and 160 characters");
    }
}

#[cfg(test)]
mod test;
