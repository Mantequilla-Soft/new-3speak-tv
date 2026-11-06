import { HIVE_API_URL } from "../../utils/config";
import axios from "axios";




export const createUserDetailsSlice = (set) => ({
    userhiveDetails: null,
    userName: null,
    setUserHiveDetails: async (name) => {
        set({userName:name});
    },
    getUserHiveDetails: async (name) => {
        console.log('condenser_api.get_accounts')
      const body = {
        id: 6,
        jsonrpc: "2.0",
        method: "condenser_api.get_accounts",
        params: [
            [`${name}`]
        ]
      };
      // Make a POST request using Axios with headers and body
      const response = await axios.post(
        HIVE_API_URL,
        body,
        {
          headers: {
            // Set your custom headers here
            "Content-Type": "application/json",
            "Accept": "application/json",
            // "Access-Control-Allow-Origin": "*",
          },
        }
      ); 
      console.log("response.data.result juneroy",response.data.result)
      if (response && response.data && response.data.result && response.data.result[0] && response.data.result[0].posting_json_metadata) {
        const profile = JSON.parse(response.data.result[0].posting_json_metadata  ) 
        set({ userhiveDetails: profile.profile });
        console.log('response from hive',response.data.result[0].posting_json_metadata)
        console.log('response from hive parse',JSON.parse(response.data.result[0].posting_json_metadata))
      }
     
      return response
  },
});
