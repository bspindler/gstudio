// Hal (scripts/hal) is the nightly polish loop. It runs only on Brian's Mac: sandbox-exec, launchd and POSIX paths and
// modes. Its tests assume that and are not run on Windows. The games, packages and services are tested everywhere.
const hal = process.platform === 'win32' ? [] : ['scripts/hal'];
export default ['packages/*', 'adapters/*', 'services/*', ...hal];
