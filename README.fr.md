[English](README.md) | [Français](README.fr.md)

# opencode-backlog

Un backlog de projet persistant pour les agents OpenCode V2 et la TUI.

`opencode-backlog` fournit à l'agent des outils pour gérer les tâches du projet. Il ajoute aussi un backlog interactif à la barre latérale et à la palette de commandes d'OpenCode.

Paquet publié : [opencode-backlog sur npm](https://www.npmjs.com/package/opencode-backlog).

![Barre latérale du backlog dans OpenCode](docs/images/opencode-backlog.jpg)

## Fonctionnement

Le plugin stocke les tâches et les catégories ordonnées dans `BACKLOG.json`, à la racine du projet.

Les nouveaux backlogs contiennent ces catégories :

- `todo`
- `doing`
- `done`

Vous pouvez ajouter, renommer, personnaliser, réordonner, purger et supprimer des catégories. Chaque catégorie possède un identifiant stable et un titre modifiable.

Le plugin serveur gère les tâches et les catégories. Le plugin TUI fournit :

- Un résumé actualisé du backlog sous le contexte de la barre latérale.
- Une commande `Browse backlog` dans la palette de commandes.
- Les commandes slash `/backlog` et `/tasks`.
- Les détails des tâches et les changements de catégorie depuis la TUI.
- La commande `/backlog-purge` pour supprimer toutes les tâches d'une catégorie sélectionnée.
- La commande `/backlog-categories` pour gérer les catégories.

## Prérequis

- OpenCode V2 avec l'API de plugin en version bêta.
- Node.js 24 et npm, ou Nix avec les flakes activés.

L'environnement de développement Nix fournit Node.js 24 et npm quand vous utilisez Nix.

Le plugin cible actuellement `@opencode-ai/plugin@0.0.0-beta-17927`.

## Installation avec Node.js

Clonez le dépôt et compilez le plugin :

```sh
git clone https://github.com/sachahjkl/opencode-backlog.git
cd opencode-backlog
npm ci
npm run build
pwd
```

Ajoutez le point d'entrée du serveur à `opencode.jsonc`. Remplacez `/absolute/path/to/opencode-backlog` par le chemin affiché par `pwd`.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/absolute/path/to/opencode-backlog/dist/index.js"
  ]
}
```

Ajoutez le point d'entrée de la TUI à `~/.config/opencode/cli.json` :

```json
{
  "plugins": [
    "/absolute/path/to/opencode-backlog/dist/tui.js"
  ]
}
```

Redémarrez le service OpenCode et rouvrez la TUI :

```sh
opencode2 service restart
```

## Installation avec Nix

Compilez le paquet :

```sh
nix build github:sachahjkl/opencode-backlog
realpath result
```

Le résultat contient deux points d'entrée de plugin :

```text
result/lib/opencode-backlog/dist/index.js
result/lib/opencode-backlog/dist/tui.js
```

Ajoutez le point d'entrée du serveur à `opencode.jsonc`. Remplacez `/nix/store/...` par le chemin affiché par `realpath result`.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/nix/store/...-opencode-backlog-0.1.0/lib/opencode-backlog/dist/index.js"
  ]
}
```

Ajoutez le point d'entrée de la TUI à `~/.config/opencode/cli.json` :

```json
{
  "plugins": [
    "/nix/store/...-opencode-backlog-0.1.0/lib/opencode-backlog/dist/tui.js"
  ]
}
```

Redémarrez le service OpenCode après la première installation :

```sh
opencode2 service restart
```

Rouvrez la TUI pour charger son plugin.

## Utilisation du backlog

Demandez à l'agent de gérer les tâches en langage courant :

```text
Add a Todo task to document the release process.
Add a Blocked category after Doing.
Move the release task to Blocked.
Purge all tasks in Done.
```

Ouvrez la palette de commandes et sélectionnez `Browse backlog` pour consulter les tâches. Sélectionnez une tâche pour afficher son identifiant, ses notes et sa catégorie.

Exécutez `/backlog` ou `/tasks` pour ouvrir directement le même navigateur.

Le navigateur du backlog fournit ces raccourcis :

- `Enter` ouvre les détails de la tâche sélectionnée.
- `n` crée une tâche.
- `c` change la catégorie de la tâche sélectionnée.
- `e` modifie la tâche sélectionnée.
- `d` supprime la tâche sélectionnée après confirmation.
- `p` purge toutes les tâches d'une catégorie sélectionnée après confirmation.

Cliquez sur une tâche de la barre latérale pour ouvrir ses détails. La boîte de dialogue fournit `c`, `e` et `d` pour les mêmes actions.

## Outils de l'agent

| Outil | Fonction |
| --- | --- |
| `backlog_list` | Répertorie les tâches avec les filtres facultatifs `category` et `query`. |
| `backlog_add` | Ajoute une tâche avec une catégorie et une position facultatives. |
| `backlog_update` | Modifie le titre ou les notes d'une tâche. |
| `backlog_move` | Modifie la catégorie ou la position d'une tâche. |
| `backlog_remove` | Supprime définitivement une tâche. |
| `backlog_category_add` | Ajoute une catégorie avec un identifiant stable, un titre, une couleur et une icône. |
| `backlog_category_update` | Modifie le titre, la couleur ou l'icône d'une catégorie. |
| `backlog_category_move` | Modifie la position d'une catégorie. |
| `backlog_category_remove` | Supprime une catégorie vide. |
| `backlog_category_purge` | Supprime définitivement toutes les tâches d'une catégorie. |

L'agent reçoit les identifiants des tâches depuis `backlog_list` et depuis le résultat de chaque modification.

## Fichier du backlog

Le plugin crée `BACKLOG.json` lors de l'ajout de la première tâche ou catégorie :

```json
{
  "version": 2,
  "categories": [
    { "id": "todo", "title": "Todo", "color": "subdued", "icon": "circle" },
    { "id": "doing", "title": "Doing", "color": "warning", "icon": "dot" },
    { "id": "blocked", "title": "Blocked", "color": "error", "icon": "cross" },
    { "id": "done", "title": "Done", "color": "success", "icon": "check" }
  ],
  "items": [
    {
      "id": "c50437e3-2a57-424d-9257-32ec432145a9",
      "title": "Add invoice search",
      "notes": "Search by customer name and invoice number.",
      "status": "doing"
    }
  ]
}
```

Le tableau des catégories définit leur ordre. Le tableau des éléments définit l'ordre des tâches dans chaque catégorie.

Les identifiants de catégorie restent stables quand les titres changent. Le plugin refuse les tâches qui font référence à un identifiant de catégorie inconnu.

Les couleurs des catégories utilisent des valeurs adaptées au thème : `default`, `subdued`, `error`, `warning`, `success` ou `info`.

Les icônes des catégories utilisent `circle`, `dot`, `check`, `cross`, `pause`, `diamond` ou `none`.

Les identifiants de catégorie connus fournissent des styles prédéfinis en l'absence de couleur ou d'icône :

| Identifiant | Couleur | Icône |
| --- | --- | --- |
| `todo` | `subdued` | `circle` |
| `doing` | `warning` | `dot` |
| `blocked` | `error` | `cross` |
| `review` | `info` | `diamond` |
| `waiting` | `warning` | `pause` |
| `done` | `success` | `check` |
| `cancelled` | `subdued` | `cross` |

Le plugin lit les fichiers de version 1 avec les catégories par défaut. La modification suivante du backlog écrit le fichier en version 2.

Validez `BACKLOG.json` quand le backlog doit suivre le projet. Ignorez-le quand le backlog doit rester local.

## Vérification de l'installation

Répertoriez les plugins serveur actifs :

```sh
opencode2 api get /api/plugin
```

La réponse doit contenir `opencode.backlog`.

Ouvrez la palette de commandes dans la TUI. La commande `Browse backlog` confirme le chargement du point d'entrée de la TUI.

## Développement

Exécutez toutes les commandes de développement avec Nix :

```sh
nix develop
nix develop -c pre-commit run --all-files
nix develop -c npm run check
nix develop -c npm test
nix flake check --print-build-logs
```

La commande `nix develop` installe le hook pre-commit du dépôt. Le hook vérifie le formatage Nix, GitHub Actions, JSON, les conflits de fusion, la taille des fichiers et les espaces.

La suite de tests n'utilise pas `BACKLOG.json`.

## Publication

Publiez chaque version depuis un poste de travail authentifié :

```sh
npm login
npm publish
```

Mettez à jour la version du paquet, puis poussez son commit et son tag :

```sh
npm version patch
git push origin master --follow-tags
```

Utilisez `minor` ou `major` au lieu de `patch` quand la version l'exige. Gardez un tag identique à la version de `package.json`.

## Compatibilité

Ce projet cible OpenCode V2. L'API de plugin V2 est en version bêta et peut changer entre les versions d'OpenCode.

Faites correspondre la version de l'API de plugin dans `package.json` avec la version d'OpenCode qui charge le plugin.
