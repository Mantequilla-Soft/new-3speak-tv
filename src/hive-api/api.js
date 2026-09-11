// import { keychainBroadcast, addAccountTokeychain } from "../helpers/keychain";
import { Client, PrivateKey } from "@hiveio/dhive";
import { getHiveClient, getHiveUrl } from '../utils/hiveNode';
import axios from "axios";
import { broadcastWithAioha, isLoggedIn, KeyTypes } from "./aioha";
import { HIVE_API_URL, HIVE_API_NODES } from "../utils/config";

const client = getHiveClient();
  const bridgeApiCall = (endpoint, params) =>
    client.call("bridge", endpoint, params);

  // Hive Bridge API helper
  export const hiveBridgeCall = async (method, params = {}) => {
    const { data } = await axios.post(getHiveUrl(), {
      jsonrpc: "2.0",
      id: 1,
      method: "bridge." + method,
      params,
    });
    return data.result;
  };

  export const getHiveUserProfile = async (username) => {
  return await hiveBridgeCall("get_profile", { account: username });
};



  export const getCommunity = async (name, observer = "") => {
    try {
          const result = await bridgeApiCall("get_community", { name, observer });
          return result;
      } catch (error) {
          console.error(error);
          return null;
      }
  };

  export const getFollowers = async (username)=>{
    try{
      const count = await client.database.call('get_follow_count', [username]);
      return count
    } catch (error){
      console.error(error);
          return null;
    }
  }



export const getRelationshipBetweenAccounts = async (follower , following) => {
  console.log(following, follower )
  try {
    const relation = await client.call(
      "bridge",
      "get_relationship_between_accounts",
      [follower, following]
    );
    console.log(relation)
    return relation;
  } catch (error) {
    console.error(error);
    return null;
  }
};


//   export async function getFollowCount(username) {
//   try {
//     const result = await client.call('follow_api', 'get_follow_count', [username]);
//     // Result contains follower_count and following_count
//     return {
//       followers: result.follower_count,
//       following: result.following_count
//     };
//   } catch (error) {
//     console.error('Error fetching follow count:', error);
//     return {
//       followers: 0,
//       following: 0
//     };
//   }
// }

  export const isAccountValid = async (username)=>{
    try {
      const accounts = await client.database.getAccounts([username]);
      return accounts.length > 0;
    } catch (error) {
      console.error('Error fetching account:', error);
      return false;
    }
  }

  export const fetchBalances = async (user) => {
    console.log(user)
    try {
      const [account] = await client.database.getAccounts([user]);
      const dgp = await client.database.getDynamicGlobalProperties();

      const vestsToHP = (vests) => {
        const totalVests = parseFloat(dgp.total_vesting_shares.split(' ')[0]);
        const totalHP = parseFloat(dgp.total_vesting_fund_hive.split(' ')[0]);
        return (vests * totalHP) / totalVests;
      };

      return({
        hp: vestsToHP(parseFloat(account.vesting_shares.split(' ')[0])),
        hbd: parseFloat(account.hbd_balance.split(' ')[0]),
        hive: parseFloat(account.balance.split(' ')[0]),
        savings_hbd: parseFloat(account.savings_hbd_balance.split(' ')[0])
      });

    } catch (err) {
      console.error('Failed to fetch balances', err);
      
    } 
  };


  // Hive validates that an authority's account_auths are sorted by name and
  // rejects the operation otherwise, which is easy to miss because it only
  // fails at broadcast time.
  const sortAuths = (auths) =>
    [...auths].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  export const createHiveCommunityKY = async (username, communityName, keys, activeKey) => {
    return new Promise(async (resolve, reject) => {
      // Same operation as every other route, from the one builder: a pasted key
      // must create exactly the account a wallet would.
      const operation = buildAccountCreateOp(username, communityName, keys);
  
      try {
        // Sign and broadcast the transaction using the creator's active key
        const privateKey = PrivateKey.fromString(activeKey);
        const result = await client.broadcast.sendOperations([operation], privateKey);
        
        resolve(result);
      } catch (error) {
        console.log("Error creating community:", error);
        reject(error);
      }
    });
  };

  /**
   * The account_create operation, shared by every route that signs it.
   *
   * Extracted so a wallet that signs WITHOUT an app login (see
   * createHiveCommunityWithKeychain) broadcasts byte-for-byte the same thing as
   * the aioha path. Two copies of an authority structure is how one of them
   * quietly drifts.
   */
  export const buildAccountCreateOp = (username, communityName, keys) => {
    const owner = {
      weight_threshold: 1,
      account_auths: [],
      key_auths: [[keys.ownerPubkey, 1]]
    };
    const active = {
      weight_threshold: 1,
      account_auths: [],
      key_auths: [[keys.activePubkey, 1]]
    };
    const posting = {
      // ONLY the creator. This used to also hand posting authority to
      // "ecency.app" -- copied in from Ecency's own creation flow -- so every
      // community and badge made on 3Speak silently granted another app posting
      // rights over it, in perpetuity, and gave the person who paid the 3 HIVE
      // no say in it. Nothing here needs a third party to be able to post.
      //
      // sortAuths is kept even for a single entry: Hive REJECTS an authority
      // whose account_auths are not in lexicographic order, so anything added
      // here later is ordered by construction rather than by remembering to.
      weight_threshold: 1,
      account_auths: sortAuths([[username, 1]]),
      key_auths: [[keys.postingPubkey, 1]]
    };

    return ["account_create", {
      creator: username,
      new_account_name: communityName,
      owner,
      active,
      posting,
      memo_key: keys.memoPubkey,
      json_metadata: "",
      extensions: [],
      fee: "3.000 HIVE"
    }];
  };

  /**
   * Create the account by asking the Keychain EXTENSION to sign, with no app login.
   *
   * Signing one transaction and logging in are different things, and the screen
   * that offers this is asking for the first. Calling aioha.login() there
   * replaced the user's identity -- a ButrAuth session was swapped for a wallet
   * one mid-flow, which is not something somebody clicking "sign" agreed to.
   *
   * requestBroadcast asks Keychain for a single Active-key signature and leaves
   * the session alone.
   */
  export const createHiveCommunityWithKeychain = (username, communityName, keys) =>
    new Promise((resolve, reject) => {
      const kc = typeof window !== "undefined" && window.hive_keychain;
      if (!kc) {
        reject(new Error("Hive Keychain is not installed in this browser"));
        return;
      }
      const operation = buildAccountCreateOp(username, communityName, keys);
      kc.requestBroadcast(username, [operation], "Active", async (resp) => {
        if (!resp || resp.success !== true) {
          reject(new Error(resp?.message || "Keychain did not sign the transaction"));
          return;
        }
        // Best-effort convenience, exactly as the aioha path does it.
        try {
          await addAccountTokeychain(communityName, {
            active: keys.active,
            posting: keys.posting,
            memo: keys.memo
          });
        } catch (e) {
          console.log("Could not add account to Keychain:", e);
        }
        resolve({ success: true, result: resp.result });
      });
    });

  export const createHiveCommunity = async (username, communityName, keys) => {
    const memoKey = keys.memo;
    const activeKey = keys.active;
    const postingKey = keys.posting;

    // Built once, in buildAccountCreateOp, so this and the Keychain route cannot
    // broadcast different authority structures.
    const operation = buildAccountCreateOp(username, communityName, keys);

    if (!isLoggedIn()) {
      throw new Error("Please login to create a community");
    }

    try {
      const response = await broadcastWithAioha([operation], KeyTypes.Active);

      // Try to add account to Keychain if available (Keychain-specific feature)
      try {
        await addAccountTokeychain(communityName, {
          active: activeKey,
          posting: postingKey,
          memo: memoKey
        });
      } catch (keychainError) {
        // Keychain may not be available if using HiveAuth, this is okay
        console.log("Could not add account to Keychain:", keychainError);
      }

      return response;
    } catch (err) {
      console.log("Error creating community:", err);
      throw err;
    }
  };

  /**
   * Write the new account's own profile, and for a community its props.
   *
   * 🚨 WITHOUT THIS THE FORM IS DECORATIVE. account_create carries
   * `json_metadata: ""`, so the title and description someone typed were
   * collected, validated, and then thrown away: the community appeared
   * untitled, with no avatar and no description, after they had paid 3 HIVE.
   *
   * Signed with the NEW account's own posting key, which we have because we
   * just generated it. posting_json_metadata and the community `updateProps`
   * op both accept posting authority, so the user's own active key is not
   * needed again after the create.
   *
   * Best-effort by design: the account EXISTS once account_create lands, and
   * that is the part that cost money. If this second broadcast fails the user
   * still owns the account and can set it up later, so it must not be reported
   * as "creation failed".
   */
  export const finalizeNewAccount = async (accountName, keys, { profile, community }) => {
    const ops = [];

    // The avatar, banner, display name and bio. This is what every Hive app
    // reads to render an account, communities included.
    ops.push(["account_update2", {
      account: accountName,
      json_metadata: "",
      posting_json_metadata: JSON.stringify({ profile }),
      extensions: []
    }]);

    // A community's title and description do NOT live in that metadata: they
    // live in hivemind's own community table, set by this custom_json. Setting
    // only the profile above is why a community can look right on its account
    // page and still be untitled in the directory.
    if (community) {
      ops.push(["custom_json", {
        required_auths: [],
        required_posting_auths: [accountName],
        id: "community",
        json: JSON.stringify(["updateProps", {
          community: accountName,
          props: community
        }])
      }]);
    }

    const postingKey = PrivateKey.fromString(keys.posting);
    return client.broadcast.sendOperations(ops, postingKey);
  };

  export const  genCommuninityName = () => {
    return `hive-${Math.floor(Math.random() * 100000) + 100000}`;
  };

  // A badge is a plain Hive account named `badge-<digits>` -- the same
  // convention PeakD reads, which is why /b/<account> already renders one.
  export const genBadgeName = () => {
    return `badge-${Math.floor(Math.random() * 900000) + 100000}`;
  };

  // Is this name taken? bridge.get_community only answers for communities, so
  // a badge needs the plain account lookup. Returns true when the name is
  // already an account, and true on an ERROR as well: a name that cannot be
  // checked must not be reported as free, since the next step spends 3 HIVE.
  export const accountExists = async (name) => {
    try {
      const client = getHiveClient();
      const [account] = await client.database.getAccounts([name]);
      return !!account;
    } catch (error) {
      console.error('accountExists failed:', error);
      // Fails to "taken" ON PURPOSE: its callers are about to CREATE an account,
      // and letting a network blip read as "free" walks them into a broadcast
      // that fails. Anything that needs to tell "taken" from "could not ask"
      // must use handleStateOnHive below instead.
      return true;
    }
  };

  /**
   * Is this name registered on Hive? 'free' | 'taken' | 'unknown'.
   *
   * The three-state answer is the whole point. A warm-up handle is NOT a
   * reservation -- nothing short of creating the account holds a name -- so
   * somebody else can register it before the user graduates, and we want to warn
   * them. But accountExists() answers a network failure with "taken", which here
   * would tell every warm-up user their name was gone during any Hive hiccup and
   * send them off to rename themselves for nothing.
   *
   * 'unknown' is the honest answer to a failed lookup, and callers are expected
   * to do nothing with it.
   */
  export const handleStateOnHive = async (name) => {
    const clean = String(name || '').trim().toLowerCase();
    if (!clean) return 'unknown';
    try {
      const client = getHiveClient();
      const accounts = await client.database.getAccounts([clean]);
      // A successful call returns an array; an empty one means nobody has it.
      if (!Array.isArray(accounts)) return 'unknown';
      return accounts.length && accounts[0] ? 'taken' : 'free';
    } catch (error) {
      console.warn('handleStateOnHive failed:', error?.message);
      return 'unknown';
    }
  };

  export const getPrivateKeys = (username, password) => {
    const roles = ["owner", "active", "posting", "memo"];
    
    let privKeys = {
      owner: "",
      active: "",
      posting: "",
      memo: "",
      ownerPubkey: "",
      activePubkey: "",
      postingPubkey: "",
      memoPubkey: ""
    };
  
    roles.forEach((role) => {
      privKeys[role] = PrivateKey.fromLogin(username, password, role).toString();
      privKeys[`${role}Pubkey`] = PrivateKey.from(privKeys[role]).createPublic().toString();
    });
  
    return privKeys;
  };

  export const arrayToHex = (array) => {
    return Array.from(array, (byte) => {
      return ('0' + (byte & 0xff).toString(16)).slice(-2);
    }).join('');
  }
  
  export const generatePassword = async (length) => {
    if (typeof window.crypto !== "undefined" && typeof window.crypto.getRandomValues === "function") {
      const randomValues = new Uint8Array(length);
      window.crypto.getRandomValues(randomValues);
      const password = `P${PrivateKey.fromSeed(arrayToHex(randomValues)).toString()}`;
      return password;
    } else {
      throw new Error("crypto.getRandomValues is not supported in this browser.");
    }
  };

  export const createHiveCommunityX = async (user, communityName, communityKeys) => {
    if (!isLoggedIn()) {
      throw new Error("Please login to create a community");
    }

    const customJsonOp = ["custom_json", {
      required_auths: [user],
      required_posting_auths: [],
      id: "community_create",
      json: JSON.stringify({
        creator: user,
        name: communityName,
        keys: communityKeys,
      }),
    }];

    const response = await broadcastWithAioha([customJsonOp], KeyTypes.Active);
    return response;
  };
  


//   ***********Keychain***************

// Legacy keychainBroadcast - now uses aioha for multi-provider support
export const keychainBroadcast = async (account, operations, key, rpc = null) => {
  console.warn('keychainBroadcast is deprecated. Use broadcastWithAioha from aioha.js instead.');

  if (!isLoggedIn()) {
    throw new Error("Please login first");
  }

  // Map key type string to aioha KeyTypes
  const keyTypeMap = {
    'Active': KeyTypes.Active,
    'Posting': KeyTypes.Posting,
    'Memo': KeyTypes.Memo
  };

  const keyType = keyTypeMap[key] || KeyTypes.Active;
  return await broadcastWithAioha(operations, keyType);
};

export const addAccountTokeychain = (username, keys) => new Promise((resolve, reject) => {
  if (window.hive_keychain) {
      window.hive_keychain.requestAddAccount(username, keys, (resp) => {
          if (!resp.success) {
              reject({ message: "Operation cancelled" });
          }
          resolve(resp);
      });
  } else {
      reject({ message: "Hive Keychain not available" });
  }
});