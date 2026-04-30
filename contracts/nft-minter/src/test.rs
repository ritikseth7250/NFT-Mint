extern crate std;

use super::{NftMinter, NftMinterClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[test]
fn mint_and_read_back_token() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(NftMinter, ());
    let client = NftMinterClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    let token_id = client.mint(
        &owner,
        &String::from_str(&env, "Level 2 Test NFT"),
        &String::from_str(&env, "Minted from the Soroban test suite."),
        &String::from_str(&env, "https://example.com/nft.png"),
    );

    assert_eq!(token_id, 1);
    assert_eq!(client.get_total_minted(), 1);

    let token = client.get_token(&1);
    assert_eq!(token.owner, owner);
    assert_eq!(token.name, String::from_str(&env, "Level 2 Test NFT"));
    assert_eq!(client.get_recent_tokens(&5).len(), 1);
}
