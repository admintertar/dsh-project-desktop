import {accountCredentialProvider} from './account-credentials.mjs';
import {officialCredentials} from './credential-runtime.mjs';

// These paths are supplied by the owning Shell, never by renderer requests.
// This adapter lives in our application; the immutable official runtime stays intact.
const {DSH_PROJECT_OFFICIAL_RUNTIME, DSH_PROJECT_ACCOUNT_STORE} = process.env;
if (!DSH_PROJECT_OFFICIAL_RUNTIME || !DSH_PROJECT_ACCOUNT_STORE) throw new Error('Shell account configuration is missing');
export default accountCredentialProvider(await officialCredentials(DSH_PROJECT_OFFICIAL_RUNTIME), DSH_PROJECT_ACCOUNT_STORE);
