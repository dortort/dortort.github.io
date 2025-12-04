# Francis Eytan Dortort

This repository contains the source code for my personal website and blog, built with [Hugo](https://gohugo.io/).

## Overview

- **Author:** Francis Eytan Dortort
- **Role:** Senior DevSecOps Engineer | Cloud Solutions Architect
- **Content:** Technical blog posts, CV, and portfolio.

## Tech Stack

- **Generator:** [Hugo](https://gohugo.io/)
- **Styling:** Custom CSS
- **Hosting:** GitHub Pages

## Local Development

### Prerequisites

- Node.js & Yarn (for dependency management)
- Hugo (extended version recommended, though the project includes a local dependency)

### Setup

1.  Clone the repository:
    ```bash
    git clone https://github.com/dortort/dortort.github.io.git
    cd dortort.github.io
    ```

2.  Install dependencies:
    ```bash
    yarn install
    ```

### Running locally

Start the Hugo development server:

```bash
yarn run hugo server
```

Or if you have Hugo installed globally:

```bash
hugo server
```

Navigate to `http://localhost:1313/` to view the site.

## Building

To build the static site for production:

```bash
yarn run hugo
```

The generated files will be in the `public/` directory.

## Deployment

Deployment is automated via GitHub Actions.

-   **Pull Requests:** The `Build Check` workflow runs on every PR to verify that the site builds correctly.
-   **Main Branch:** Pushes to the `main` branch trigger the `GitHub Pages` workflow, which builds the site and deploys it to GitHub Pages.

