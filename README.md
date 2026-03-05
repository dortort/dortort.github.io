# Francis Eytan Dortort

[![GitHub Pages](https://github.com/dortort/dortort.github.io/actions/workflows/hugo.yaml/badge.svg)](https://github.com/dortort/dortort.github.io/actions/workflows/hugo.yaml)
[![POSSE Cross-Post](https://github.com/dortort/dortort.github.io/actions/workflows/posse.yml/badge.svg)](https://github.com/dortort/dortort.github.io/actions/workflows/posse.yml)
[![Hugo](https://img.shields.io/badge/Hugo-0.110.0-ff4088?logo=hugo)](https://gohugo.io/)
[![GitHub Pages](https://img.shields.io/badge/Hosted_on-GitHub_Pages-222?logo=githubpages)](https://dortort.com/)

This repository contains the source code for my personal website and blog, built with [Hugo](https://gohugo.io/).

## Overview

- **Author:** Francis Eytan Dortort
- **Role:** Senior DevSecOps Engineer | Cloud Solutions Architect
- **Content:** Technical blog posts, CV, and portfolio.

## Tech Stack

- **Generator:** [Hugo](https://gohugo.io/)
- **Styling:** Custom CSS
- **Hosting:** GitHub Pages
- **PDF Generation:** [Puppeteer](https://pptr.dev/) (headless Chrome)

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

## CV PDF Generation

The CV is rendered as an HTML page (`/cv-pdf/`) and converted to a single-page A4 PDF using Puppeteer. The script auto-fits content by adjusting spacing density (within ±20%) to fill the page.

### Generating the PDF locally

Build the site and generate the PDF in one step:

```bash
npm run pdf
```

Or, if the site is already built (`public/` exists):

```bash
npm run pdf:only
```

The generated PDF is written to `static/Francis_Eytan_Dortort_CV.pdf`.

### How it works

1. `scripts/generate-pdf.mjs` starts a local static server serving the `public/` directory.
2. Puppeteer navigates to the `/cv-pdf/` page.
3. A binary search adjusts CSS custom properties (spacing, line-height, gaps) to fit content within the A4 content area.
4. The page is printed to PDF. The script validates the output is exactly one page.

## Deployment

Deployment is automated via GitHub Actions.

-   **Pull Requests:** The `Build Check` workflow runs on every PR to verify that the site builds correctly.
-   **Main Branch:** Pushes to the `main` branch trigger the `GitHub Pages` workflow, which builds the site, generates the CV PDF, and deploys everything to GitHub Pages.

The deploy pipeline runs these steps: `checkout` → `hugo --minify` → `npm run pdf:only` → `cp` PDF to `public/` → `deploy`.

