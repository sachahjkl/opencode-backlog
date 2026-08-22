{
  description = "OpenCode backlog plugin";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs, ... }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      checks = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          lib = pkgs.lib;
          packageJson = builtins.fromJSON (builtins.readFile ./package.json);
          src = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions [
              ./LICENSE
              ./README.md
              ./package-lock.json
              ./package.json
              ./src
              ./test
              ./tsconfig.build.json
              ./tsconfig.json
              ./tsconfig.test.json
            ];
          };
          npmDeps = pkgs.fetchNpmDeps {
            inherit src;
            hash = "sha256-FNOFJxBpBCrQ1/h488MMBaYuTm9Q7ijV1Mi6r4qfXY4=";
          };
          mkCheck =
            name: command:
            pkgs.stdenvNoCC.mkDerivation {
              inherit src npmDeps;
              name = "${packageJson.name}-${name}";
              nativeBuildInputs = [
                pkgs.nodejs_24
                pkgs.npmHooks.npmConfigHook
              ];
              dontBuild = true;
              installPhase = ''
                runHook preInstall
                ${command}
                touch $out
                runHook postInstall
              '';
            };
          plugin = pkgs.stdenvNoCC.mkDerivation {
            inherit src npmDeps;
            pname = packageJson.name;
            inherit (packageJson) version;
            nativeBuildInputs = [
              pkgs.nodejs_24
              pkgs.npmHooks.npmConfigHook
            ];
            buildPhase = ''
              runHook preBuild
              npm run build
              npm pack --dry-run --cache "$TMPDIR/npm-cache"
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              root="$out/lib/${packageJson.name}"
              mkdir -p "$root"
              cp -r dist node_modules "$root/"
              rm -rf "$root/node_modules/solid-js" "$root/node_modules/@opentui"
              cp LICENSE README.md package.json "$root/"
              runHook postInstall
            '';
          };
          workflowSource = lib.fileset.toSource {
            root = ./.;
            fileset = ./.github;
          };
        in
        {
          actionlint =
            pkgs.runCommand "${packageJson.name}-actionlint"
              {
                nativeBuildInputs = [ pkgs.actionlint ];
              }
              ''
                actionlint ${workflowSource}/.github/workflows/*.yml
                touch $out
              '';
          build = plugin;
          test = mkCheck "test" "npm test";
          typecheck = mkCheck "typecheck" "npm run check";
        }
      );

      packages = forAllSystems (system: {
        default = self.checks.${system}.build;
      });

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShellNoCC {
            packages = [ pkgs.nodejs_24 ];
          };
        }
      );

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
