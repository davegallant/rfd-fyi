{
  description = "rfd-fyi development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Node.js LTS with npm
            nodejs_20

            # Go for backend
            go

            # Build tools
            pkg-config

            # Development utilities
            git
            curl
            jq

            # Optional: for better development experience
            gnumake
          ];

          shellHook = ''
            echo "🚀 rfd-fyi development environment loaded"
            echo "Available commands:"
            echo "  Frontend: npm install, npm run build, npm run serve"
            echo "  Backend:  cd backend && CGO_ENABLED=0 go run ."
            echo ""
            echo "Node version: $(node --version)"
            echo "npm version: $(npm --version)"
            echo "Go version: $(go version)"
            echo ""
            echo "Tip: Run 'npm install' to install frontend dependencies"
            echo "Tip: Vite is available via 'npx vite' or 'npm run build'"
          '';
        };
      }
    );
}
