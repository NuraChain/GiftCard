// Both halves under one banner: the API on :3000, vite on :5173 with /api proxied to it.
//
// This replaced the framework's own `dev` command. It is deliberately small - two child
// processes and a shared exit - because the only thing the two halves need from each other
// in development is the proxy line in application/vite.config.ts.
import { spawn } from 'node:child_process';

const HALVES = [
    { name: 'server', args: ['run', 'start', '--workspace', 'server'] },
    { name: 'client', args: ['run', 'dev', '--workspace', 'application'] }
];

const running = HALVES.map(({ name, args }) =>
{
    // `shell: true` on Windows, where `npm` is a .cmd and cannot be executed directly.
    const child = spawn('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) =>
    {
        // One half dying alone leaves a half-running app that looks fine until the first
        // request crosses between them, so the other goes too.
        process.stdout.write(`\n  ${ name } exited (${ code ?? 'signal' }) - stopping the other half.\n`);
        stop();
        process.exit(code ?? 1);
    });
    return child;
});

function stop()
{
    for (const child of running)
    {
        if (child.exitCode === null)
        {
            child.kill();
        }
    }
}

for (const signal of ['SIGINT', 'SIGTERM'])
{
    process.on(signal, () =>
    {
        stop();
        process.exit(0);
    });
}
