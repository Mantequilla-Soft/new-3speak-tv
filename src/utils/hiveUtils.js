import { Client, SMTAsset } from '@hiveio/dhive';
import moment from 'moment';



// Connect to a Hive node
const client = new Client([
    "https://api.hive.blog",
    "https://api.openhive.network"
]);

export async function has3SpeakPostAuth(username) {
    try {
        // Fetch user account details
        const accounts = await client.database.getAccounts([username]);

        if (!accounts.length) {
            console.error(`User ${username} not found.`);
            return false;
        }

        // Log the full account details for debugging
        console.log("User Account Details:", accounts);

        // Safely extract posting auths
        const postingAuths = accounts[0]?.posting?.account_auths?.map(auth => auth[0]) || [];


        // Check if "threespeak" is in the posting auths
        return postingAuths.includes("threespeak");
    } catch (error) {
        console.error("Error checking 3Speak post authorization:", error);
        return false;
    }
}

export async function getUersContent(author, permlink) {
    try {
      const post = await client.database.call("get_content", [author, permlink]);
      // console.log("post===>", post.body);

      if (!post ) {
        console.log("Post not found");
        return null;
      }
      // Use the post body as the content
      return post;
    } catch (error) {
      console.error("Error fetching post:", error);
      return null;
    }
  }

//   export async function getContentData(author, permlink) {
//   try {
//     const post = await client.database.call("get_content", [author, permlink]);

//     if (post) {
//       let data = {
//         activeVoters: post.active_votes,
//         payout: post.pending_payout_value
//       };
//       return data;
//     }

//     console.log("Post not found");
//     return null;
//   } catch (error) {
//     console.error("Error fetching post:", error);
//     return null;
//   }
// }

export async function getContentData(active_user, author, permlink, setHasVoted1) {
  const post = await client.database.call("get_content", [author, permlink]);

  if (!post) return null;

  let payout =
    post.last_payout <= "1970-01-01T00:00:00"
      ? parseFloat(post.pending_payout_value)
      : parseFloat(post.total_payout_value) +
        parseFloat(post.curator_payout_value);


      const isVoted = post.active_votes?.some(
    (vote) => vote.voter === active_user
  ) || false;

  // if (isVoted) {
  //   setHasVoted1(isVoted);
  // }

  return {
    payout: payout.toFixed(2),
    voters: post.active_votes?.length || 0,
    isVoted
  };
}


  export const vestsToRshares = (vests, votingPower, votePerc) => {
    const vestingShares = vests * 1e6;
    const power = (votingPower * votePerc) / 1e4 / 50 + 1;
    return (power * vestingShares) / 1e4;
  };

  export const getVotePower = async (username) => {
    try {
      // Get full account data
        const [account] = await client.database.getAccounts([username]);

        // --- Calculate Voting Power ---
        const lastVote = new Date(account.last_vote_time + 'Z');
        const now = new Date();
        const secondsSinceLastVote = (now - lastVote) / 1000;
        const regenerated = (10000 * secondsSinceLastVote) / (5 * 60 * 60 * 24);
        let vp = account.voting_power + regenerated;
        if (vp > 10000) vp = 10000;

        // --- Get RC ---
    const rcData = await client.call('rc_api', 'find_rc_accounts', { accounts: [username] });
    const rcAccount = rcData.rc_accounts?.[0];

    const maxRC = parseFloat(rcAccount.max_rc);
    const currentRC = parseFloat(rcAccount.rc_manabar.current_mana);
    const rcPercent = (currentRC / maxRC) * 100;
        return {
      vp,       // voting power
      rcPercent, // Resource Credit (0 - 100)
      account,  // full account data
      rc: rcAccount,    // Raw RC data
    };
    } catch (error) {
        console.error("Error fetching voting power:", error);
        return null;
    }
  }

  export const getRewardPool = async () => {
  try {
    const rewardFund = await client.database.call('get_reward_fund', ['post']);
    const rewardPool = await client.database.call('get_current_median_history_price');
    
    return {
      reward_balance: parseFloat(rewardFund.reward_balance.split(' ')[0]),
      recent_claims: parseFloat(rewardFund.recent_claims),
      hive_price: parseFloat(rewardPool.base.split(' ')[0]) / parseFloat(rewardPool.quote.split(' ')[0])
    };
  } catch (error) {
    console.error("Error fetching reward pool:", error);
    return {
      reward_balance: 0,
      recent_claims: 0,
      hive_price: 0
    };
  }
};

export async function getFollowers(username, start = '', limit = 100) {
  try {
    const result = await client.call('condenser_api', 'get_followers', [username, start, 'blog', limit]);
    return result.map(f => f.follower);
  } catch (e) {
    console.error('Error getting followers:', e);
    return [];
  }
}

// Get following
export async function getFollowing(username, start = '', limit = 100) {
  try {
    const result = await client.call('condenser_api', 'get_following', [username, start, 'blog', limit]);
    return result.map(f => f.following);
  } catch (e) {
    console.error('Error getting following:', e);
    return [];
  }
}



 export const SymbolMap = {
  HIVE: "HIVE",
  HBD: "HBD",
  VESTS: "VESTS",
  SPK: "SPK"
};

 export const NaiMap = {
  "@@000000021": "HIVE",
  "@@000000013": "HBD",
  "@@000000037": "VESTS"
};

 export function parseAsset(sval) {
  if (typeof sval === "string") {
    const sp = sval.split(" ");
    return {
      amount: parseFloat(sp[0]),
      symbol: SymbolMap[sp[1]]
    };
  } else {
    return {
      amount: parseFloat(sval.amount.toString()) / Math.pow(10, sval.precision),
      symbol: NaiMap[sval.nai]
    };
  }
}

export const getDynamicProps = async () => {
  try {
    const rewardFund = await client.database.call('get_reward_fund', ['post']);
    const globalDynamic = await client.database.call('get_dynamic_global_properties');
    const feedHistory = await client.database.call('get_feed_history');
    const chainProps = await client.database.call('get_chain_properties');

    const hivePerMVests =
      (parseAsset(globalDynamic.total_vesting_fund_hive).amount /
        parseAsset(globalDynamic.total_vesting_shares).amount) *
      1e6;

    const base = parseAsset(feedHistory.current_median_history.base).amount;
    const quote = parseAsset(feedHistory.current_median_history.quote).amount;
    const fundRecentClaims = parseFloat(rewardFund.recent_claims);
    const fundRewardBalance = parseAsset(rewardFund.reward_balance).amount;
    const hbdPrintRate = globalDynamic.hbd_print_rate;
    const hbdInterestRate = globalDynamic.hbd_interest_rate;
    const headBlock = globalDynamic.head_block_number;
    const totalVestingFund = parseAsset(globalDynamic.total_vesting_fund_hive).amount;
    const totalVestingShares = parseAsset(globalDynamic.total_vesting_shares).amount;
    const virtualSupply = parseAsset(globalDynamic.virtual_supply).amount;
    const vestingRewardPercent = globalDynamic.vesting_reward_percent;
    const accountCreationFee = chainProps.account_creation_fee;

    return {
      hivePerMVests,
      base,
      quote,
      fundRecentClaims,
      fundRewardBalance,
      hbdPrintRate,
      hbdInterestRate,
      headBlock,
      totalVestingFund,
      totalVestingShares,
      virtualSupply,
      vestingRewardPercent,
      accountCreationFee
    };
  } catch (err) {
    console.error('Vote value calculation failed:', err);
    return null;
  }
};


export const votingPower = (account) => {
  // @ts-ignore "Account" is compatible with dhive's "ExtendedAccount"
  const calc = account && client.rc.calculateVPMana(account);
  const { percentage } = calc;

  return percentage / 100;
};

export const accountVestingShares = (account) => {
  let effectiveVestingShares = 
    parseAsset(account.vesting_shares).amount + 
    parseAsset(account.received_vesting_shares).amount - 
    parseAsset(account.delegated_vesting_shares).amount;
  
  // If there is a power down occurring, also reduce effective vesting shares by this week's power down amount
  if (moment.utc(account.next_vesting_withdrawal).isAfter(moment.unix(0).utc())) {
    // Reduce by minimum between 'weekly amount' and 'remainder'
    const vestingWithdrawRate = parseAsset(account.vesting_withdraw_rate).amount;
    const toWithdraw = parseFloat(account.to_withdraw) / 1e6; // Convert from VESTS
    const withdrawn = parseFloat(account.withdrawn) / 1e6; // Convert from VESTS
    
    effectiveVestingShares -= Math.min(vestingWithdrawRate, toWithdraw - withdrawn);
  }
  
  return effectiveVestingShares;
};

export const calculateVoteRshares = (userEffectiveVests, voteWeight = 10000) => {
  const userVestingShares = parseInt(userEffectiveVests * 1e6, 10);
  const userVotingPower = 10000 * (Math.abs(voteWeight) / 10000);
  return userVestingShares * (userVotingPower / 10000) * 0.02;
};

export const estimate = async (account, percent) => {
  try {
    const { fundRecentClaims, fundRewardBalance, base, quote } = await getDynamicProps();
    
    if (!fundRecentClaims || !fundRewardBalance || !base || !quote) {
      console.error('Missing dynamic props data');
      return '0.000';
    }

    const sign = percent < 0 ? -1 : 1;
    
    // Get effective vesting shares (accounting for power down)
    const userEffectiveVests = accountVestingShares(account);
    
    // Calculate voting power (0-10000)
    const userVotingPower = votingPower(account) * 100; // votingPower returns 0-100, we need 0-10000
    
    // Calculate vote weight (1-10000, based on slider percent)
    const voteWeight = Math.abs(percent) * 100; // Convert percent (1-100) to weight (100-10000)
    
    // Calculate rshares
    const voteEffectiveShares = calculateVoteRshares(userEffectiveVests, userVotingPower * (voteWeight / 10000));
    
    // Calculate vote value
    const voteValue = (voteEffectiveShares / fundRecentClaims) * fundRewardBalance * (base / quote);
    
    const estimated = Math.max(voteValue, 0) * sign;
    
    return estimated.toFixed(3);
  } catch (err) {
    console.error('Vote estimation failed:', err);
    return '0.000';
  }
};