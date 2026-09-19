// One bundle keeps the plugin's error classes shared across clone and authentication code.
export {ResourceCloneManager} from '../../../.upstream/project/src/resource-clones.ts';
export {ProjectResourceStore} from '../../../.upstream/project/src/project-resources.ts';
export {ResourceGitAuthentication, gitKeyChoices} from '../../../.upstream/project/src/resource-auth.ts';
export {runResourceGit, ResourceGitError, inspectResourceGit} from '../../../.upstream/project/src/resource-git.ts';
export {createProjectFile} from '../../../.upstream/project/src/project-files.ts';
