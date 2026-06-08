const { createClient } = require("@supabase/supabase-js");
const { config } = require("./config");

function createSupabaseClient() {
  return createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

module.exports = {
  createSupabaseClient,
};
