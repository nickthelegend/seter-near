//! tUSD — a test NEP-141 token (6 decimals) used as the quote asset of Mienai's testnet pool.
//! Anyone can take 1,000 tUSD from the faucet once per hour. It has no value.
use near_contract_standards::fungible_token::metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC};
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, PromiseOrValue};

const FAUCET_AMOUNT: u128 = 1_000_000_000; // 1,000 tUSD
const FAUCET_COOLDOWN_NS: u64 = 3_600_000_000_000;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    owner_id: AccountId,
    last_faucet: LookupMap<AccountId, u64>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        Self { token: FungibleToken::new(b"t".to_vec()), owner_id, last_faucet: LookupMap::new(b"f".to_vec()) }
    }

    /// Mints 1,000 tUSD to the caller, registering storage from the attached deposit if needed.
    #[payable]
    pub fn faucet(&mut self) -> U128 {
        let account = env::predecessor_account_id();
        let now = env::block_timestamp();
        if let Some(last) = self.last_faucet.get(&account) { require!(now >= last + FAUCET_COOLDOWN_NS, "ERR_FAUCET_COOLDOWN"); }
        if !self.token.accounts.contains_key(&account) {
            let min = self.token.storage_balance_bounds().min.as_yoctonear();
            require!(env::attached_deposit().as_yoctonear() >= min, "ERR_STORAGE_DEPOSIT");
            self.token.internal_register_account(&account);
        }
        self.last_faucet.insert(account.clone(), now);
        self.token.internal_deposit(&account, FAUCET_AMOUNT);
        near_contract_standards::fungible_token::events::FtMint { owner_id: &account, amount: U128(FAUCET_AMOUNT), memo: Some("faucet") }.emit();
        U128(FAUCET_AMOUNT)
    }

    /// Owner mint, used once to seed the pool's tUSD side.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(env::predecessor_account_id() == self.owner_id, "ERR_OWNER");
        if !self.token.accounts.contains_key(&account_id) { self.token.internal_register_account(&account_id); }
        self.token.internal_deposit(&account_id, amount.0);
        near_contract_standards::fungible_token::events::FtMint { owner_id: &account_id, amount, memo: Some("owner mint") }.emit();
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) { self.token.ft_transfer(receiver_id, amount, memo) }
    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> { self.token.ft_transfer_call(receiver_id, amount, memo, msg) }
    fn ft_total_supply(&self) -> U128 { self.token.ft_total_supply() }
    fn ft_balance_of(&self, account_id: AccountId) -> U128 { self.token.ft_balance_of(account_id) }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 { near_contract_standards::fungible_token::events::FtBurn { owner_id: &sender_id, amount: U128(burned), memo: None }.emit(); }
        used.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance { self.token.storage_deposit(account_id, registration_only) }
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance { self.token.storage_withdraw(amount) }
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool { self.token.internal_storage_unregister(force).is_some() }
    fn storage_balance_bounds(&self) -> StorageBalanceBounds { self.token.storage_balance_bounds() }
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> { self.token.storage_balance_of(account_id) }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata { spec: FT_METADATA_SPEC.to_string(), name: "Mienai test USD (no value)".to_string(), symbol: "tUSD".to_string(), icon: None, reference: None, reference_hash: None, decimals: 6 }
    }
}
