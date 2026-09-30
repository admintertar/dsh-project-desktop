// One bundle keeps the plugin's error classes shared across clone and authentication code.
export {ResourceCloneManager} from '@project-source/resource-clones.ts';
export {ProjectResourceStore} from '@project-source/project-resources.ts';
export {ResourceGitAuthentication, gitKeyChoices} from '@project-source/resource-auth.ts';
export {runResourceGit, ResourceGitError, inspectResourceGit} from '@project-source/resource-git.ts';
export {createProjectFile} from '@project-source/project-files.ts';
