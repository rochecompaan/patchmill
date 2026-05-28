{ pkgs, ... }:

{
  env.GREET = "Patchmill";

  packages = [ pkgs.git pkgs.python314Packages.grip ];

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    npm.enable = true;
  };

  tasks = {
    "patchmill:test".exec = "npm test";
    "patchmill:test:triage".exec = "npm run test:triage";
    "patchmill:test:run-once".exec = "npm run test:run-once";
    "patchmill:triage:dry-run".exec = "npm run patchmill -- triage --dry-run";
    "patchmill:run-once:dry-run".exec = "npm run patchmill -- run-once --dry-run";
    "patchmill:smoke" = {
      exec = ''
        npm run patchmill -- triage --dry-run
        npm run patchmill -- run-once --dry-run
      '';
      after = [ "patchmill:test" ];
    };
  };

  enterShell = ''
    echo ""
    echo "🧵 Welcome to $GREET — stitch issues into reviewed diffs."
    echo ""
    echo "Useful commands:"
    echo "  npm test"
    echo "  npm run patchmill -- triage --dry-run"
    echo "  npm run patchmill -- run-once --dry-run"
    echo ""
    echo "Useful devenv tasks:"
    echo "  devenv tasks run patchmill:test"
    echo "  devenv tasks run patchmill:smoke"
    echo ""
    node --version
  '';

  enterTest = ''
    node --version | grep --color=auto '^v24\.'
    npm --version
    npm test
  '';
}
