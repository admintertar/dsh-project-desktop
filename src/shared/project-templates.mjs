// Shared by the creation guide and bootstrap. Identifiers stay independent of locale.
export const RESOURCE_ROLE_KEYS = Object.freeze({
  backend: 'roleBackend', web: 'roleWeb', miniapp: 'roleMiniapp', app: 'roleApp',
  admin: 'roleAdmin', desktop: 'roleDesktop',
});

export const PROJECT_COMPOSITIONS = Object.freeze([
  {id: 'fullstack', key: 'fullstack', roles: ['backend', 'web']},
  {id: 'admin', key: 'admin', roles: ['backend', 'admin']},
  {id: 'miniapp', key: 'miniapp', roles: ['backend', 'miniapp']},
  {id: 'app', key: 'app', roles: ['backend', 'app']},
  {id: 'desktop', key: 'desktop', roles: ['desktop']},
  {id: 'empty', key: 'emptyTemplate', roles: []},
].map(item => Object.freeze({...item, roles: Object.freeze(item.roles)})));

export const PROJECT_TEMPLATES = Object.freeze(Object.fromEntries(PROJECT_COMPOSITIONS.map(item => [
  item.id, Object.freeze(item.roles.map(role => Object.freeze({id: role, role}))),
])));
