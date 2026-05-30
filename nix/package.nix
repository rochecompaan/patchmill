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
  version = "0.1.0";

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

  npmDepsHash = "sha256-rN0wzxKN80KGKk7JuBF39AMbUAJfvRpG6ruxKh9vHQk=";

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
    package_dir="$out/lib/node_modules/@rochecompaan/${pname}"

    mkdir -p "$out/share/${pname}"
    cp -R "$package_dir/bin" "$out/share/${pname}/bin"
    cp -R "$package_dir/src" "$out/share/${pname}/src"
    cp -R "$package_dir/extensions" "$out/share/${pname}/extensions"
    cp "$package_dir/THIRD_PARTY_NOTICES.md" "$out/share/${pname}/THIRD_PARTY_NOTICES.md"
    cp "$package_dir/package.json" "$out/share/${pname}/package.json"
    ln -s "$package_dir/node_modules" "$out/share/${pname}/node_modules"

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
    license = lib.licenses.asl20;
    platforms = lib.platforms.unix;
  };
}
