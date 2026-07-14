{
  description = "RailBack frontend dev environment (Vite + React, using bun)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        # Wrapper that installs deps with bun and starts the Vite dev server.
        # Runs from the repository root so node_modules lands in the writable
        # checkout rather than the (read-only) Nix store.
        devServer = pkgs.writeShellApplication {
          name = "railback-frontend-dev";
          runtimeInputs = [ pkgs.bun ];
          text = ''
            set -euo pipefail
            cd frontend
            export VITE_API_BASE_URL="''${VITE_API_BASE_URL:-https://ckmhi46i2xidpl7joik5hby2ba0vhlso.lambda-url.eu-north-1.on.aws}"
            bun install
            exec bun run dev --host 0.0.0.0 --port "''${PORT:-5173}"
          '';
        };
      in
      {
        packages.default = devServer;

        apps.default = {
          type = "app";
          program = "${devServer}/bin/railback-frontend-dev";
        };

        devShells.default = pkgs.mkShell {
          packages = [ pkgs.bun pkgs.nodejs ];
          shellHook = ''
            echo "RailBack frontend dev shell"
            echo "  cd frontend && bun install && bun run dev"
            echo "  or:  nix run   (starts the dev server on :5173)"
          '';
        };
      });
}
