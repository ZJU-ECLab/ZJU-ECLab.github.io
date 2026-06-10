{
  description = "Emotion & Culture Lab website — static site builder (Python + Jinja2)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        # Python interpreter with the packages build.py needs:
        #   jinja2   — HTML templating
        #   markdown — render prose pages (content/**/*.md)
        #   pyyaml   — parse structured data (content/data/*.yml)
        pythonEnv = pkgs.python3.withPackages (ps: with ps; [
          jinja2
          markdown
          pyyaml
        ]);
      in
      {
        # `nix develop` → shell with Python + deps + a local HTTP server.
        devShells.default = pkgs.mkShell {
          packages = [ pythonEnv ];

          shellHook = ''
            echo "ECLab site dev shell"
            echo "  python : $(python3 --version)"
            echo ""
            echo "  build  : python3 build.py        # generate the static site into dist/"
            echo "  serve  : python3 -m http.server 8000 --directory dist"
            echo ""
          '';
        };

        # `nix run` → build the site (once build.py exists).
        apps.default = {
          type = "app";
          program = toString (pkgs.writeShellScript "build-eclab-site" ''
            exec ${pythonEnv}/bin/python3 build.py "$@"
          '');
        };
      });
}
