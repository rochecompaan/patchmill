{
  lib,
  buildNpmPackage,
  nodejs_24,
  makeWrapper,
}:

let
  buildNpmPackageNode24 = buildNpmPackage.override { nodejs = nodejs_24; };
in
buildNpmPackageNode24 rec {
  pname = "patchmill";
  version = "0.0.0";

  src = lib.cleanSourceWith {
    src = lib.cleanSource ../.;
    filter = path: type:
      let
        baseName = baseNameOf path;
      in
      !(baseName == ".git"
        || baseName == "node_modules"
        || baseName == ".devenv"
        || baseName == ".patchmill"
        || baseName == "result");
  };

  npmDepsHash = "sha256-jY5ufe5swFmXfpYMTlfTARhqNbezEBqCOAT27vFCeVU=";

  dontNpmBuild = true;

  nativeBuildInputs = [ makeWrapper ];

  env = {
    HUSKY = "0";
  };

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    npm test
    runHook postCheck
  '';

  postInstall = ''
    mkdir -p "$out/share/${pname}"
    cp -R "$out/lib/node_modules/${pname}/bin" "$out/share/${pname}/bin"
    cp -R "$out/lib/node_modules/${pname}/src" "$out/share/${pname}/src"
    cp "$out/lib/node_modules/${pname}/package.json" "$out/share/${pname}/package.json"
    ln -s "$out/lib/node_modules/${pname}/node_modules" "$out/share/${pname}/node_modules"

    rm -f "$out/bin/patchmill"
    makeWrapper ${nodejs_24}/bin/node "$out/bin/patchmill" \
      --add-flags "$out/share/${pname}/bin/patchmill.ts"
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    $out/bin/patchmill --help >/dev/null
    runHook postInstallCheck
  '';

  meta = {
    description = "Agent-driven software factory that turns issues into reviewed diffs";
    mainProgram = "patchmill";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
  };
}
