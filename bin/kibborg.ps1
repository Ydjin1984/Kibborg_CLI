# kibborg — launcher shim for PowerShell. Prefers the built application and
# falls back to the source entry through tsx when the checkout is not built.
#
# The arguments are read from $args rather than a param() block on purpose:
# PowerShell binds a leading dash to its own common parameters, so `-o <path>`
# would be rejected as an ambiguous `-OutVariable`/`-OutBuffer` prefix before
# the shim ever saw it. $args carries every token through untouched.
#
# Pipeline input needs the same care. Piping into a SCRIPT hands the objects to
# $input; the child process never sees them on its standard input, so a task or
# a SKILL.md body would arrive empty. When the caller did pipe something, the
# shim forwards it; otherwise it connects nothing and the interactive loop keeps
# the console's own stdin.

$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$app = Join-Path $repo 'Kibborg_CLI\apps\cli'
$built = Join-Path $app 'lib\bin.js'

if ($MyInvocation.ExpectingInput) {
    if (Test-Path $built) {
        $input | & node $built @args
    } else {
        $input | & pnpm --dir $repo exec tsx (Join-Path $app 'src\bin.ts') @args
    }
} elseif (Test-Path $built) {
    & node $built @args
} else {
    & pnpm --dir $repo exec tsx (Join-Path $app 'src\bin.ts') @args
}
exit $LASTEXITCODE
