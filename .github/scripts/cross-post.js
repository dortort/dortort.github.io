const fs = require('fs');
const path = require('path');
const axios = require('axios');
const matter = require('gray-matter');

// Configuration
const DEVTO_API_KEY = process.env.DEVTO_API_KEY;
const HASHNODE_ACCESS_TOKEN = process.env.HASHNODE_ACCESS_TOKEN;
const HASHNODE_PUBLICATION_ID = process.env.HASHNODE_PUBLICATION_ID;
const BASE_URL = "http://dortort.com";

function getCanonicalUrl(filename) {
    // content/posts/my-post.md -> http://dortort.com/posts/my-post/
    const baseName = path.basename(filename, path.extname(filename));
    return `${BASE_URL}/posts/${baseName}/`;
}

async function postToDevto(article, canonicalUrl, publishDate) {
    if (!DEVTO_API_KEY) {
        console.log("Skipping Dev.to: DEVTO_API_KEY not set");
        return;
    }

    const headers = {
        "api-key": DEVTO_API_KEY,
        "Content-Type": "application/json"
    };

    try {
        // Check if article exists
        const response = await axios.get("https://dev.to/api/articles/me/all", { headers });
        const articles = response.data;
        
        let existing = articles.find(a => a.canonical_url === canonicalUrl);
        if (!existing) {
            existing = articles.find(a => a.title === article.data.title);
        }

        const payload = {
            article: {
                title: article.data.title,
                body_markdown: article.content,
                tags: article.data.tags || [],
                canonical_url: canonicalUrl,
                published: true,
                published_at: publishDate,
                description: article.data.description || ""
            }
        };

        if (existing) {
            console.log(`Updating existing Dev.to article: ${existing.title}`);
            const updateResponse = await axios.put(`https://dev.to/api/articles/${existing.id}`, payload, { headers });
            if (updateResponse.status === 200) {
                console.log("Successfully updated on Dev.to");
            }
        } else {
            console.log(`Creating new Dev.to article: ${article.data.title}`);
            const createResponse = await axios.post("https://dev.to/api/articles", payload, { headers });
            if ([200, 201].includes(createResponse.status)) {
                console.log("Successfully published to Dev.to");
            }
        }
    } catch (error) {
        console.error(`Failed to process Dev.to: ${error.message}`);
        if (error.response) {
            console.error(error.response.data);
        }
    }
}

async function getHashnodeTagIds(tags, headers) {
    const tagIds = [];
    for (const tagName of tags) {
        const slug = tagName.toLowerCase().replace(/ /g, "-");
        const query = `
        query GetTag($slug: String!) {
            tag(slug: $slug) {
                id
            }
        }
        `;
        try {
            const response = await axios.post("https://gql.hashnode.com", {
                query,
                variables: { slug }
            }, { headers });
            
            if (response.data.data && response.data.data.tag) {
                tagIds.push({ id: response.data.data.tag.id });
            } else {
                console.log(`Tag not found on Hashnode: ${tagName}`);
            }
        } catch (error) {
            console.error(`Error fetching tag ${tagName}: ${error.message}`);
        }
    }
    return tagIds;
}

async function postToHashnode(article, canonicalUrl, publishDate) {
    if (!HASHNODE_ACCESS_TOKEN) {
        console.log("Skipping Hashnode: HASHNODE_ACCESS_TOKEN not set");
        return;
    }

    const headers = {
        "Authorization": HASHNODE_ACCESS_TOKEN,
        "Content-Type": "application/json"
    };

    let pubId = HASHNODE_PUBLICATION_ID;
    
    if (!pubId) {
        const query = `
        query {
            me {
                publications(first: 1) {
                    edges {
                        node {
                            id
                        }
                    }
                }
            }
        }
        `;
        try {
            const response = await axios.post("https://gql.hashnode.com", { query }, { headers });
            if (response.data.data && response.data.data.me.publications.edges.length > 0) {
                pubId = response.data.data.me.publications.edges[0].node.id;
            } else {
                console.error("Could not fetch Hashnode Publication ID");
                return;
            }
        } catch (error) {
            console.error(`Failed to fetch Hashnode user info: ${error.message}`);
            return;
        }
    }

    // Check for existing post
    let existingPostId = null;
    const queryPosts = `
    query GetPosts($publicationId: ObjectId!) {
        publication(id: $publicationId) {
            posts(first: 20) {
                edges {
                    node {
                        id
                        title
                        originalArticleURL
                    }
                }
            }
        }
    }
    `;
    
    try {
        const response = await axios.post("https://gql.hashnode.com", {
            query: queryPosts,
            variables: { publicationId: pubId }
        }, { headers });

        if (response.data.data && response.data.data.publication) {
            const posts = response.data.data.publication.posts.edges;
            for (const p of posts) {
                const node = p.node;
                if (node.originalArticleURL === canonicalUrl || node.title === article.data.title) {
                    existingPostId = node.id;
                    break;
                }
            }
        }
    } catch (error) {
        console.error(`Error checking existing Hashnode posts: ${error.message}`);
    }

    const tags = article.data.tags || [];
    const tagIds = await getHashnodeTagIds(tags, headers);

    const inputData = {
        title: article.data.title,
        contentMarkdown: article.content,
        originalArticleURL: canonicalUrl,
        tags: tagIds,
        publicationId: pubId,
        publishedAt: publishDate
    };

    let mutation;
    let variables;
    
    if (existingPostId) {
        console.log(`Updating existing Hashnode post: ${article.data.title}`);
        mutation = `
        mutation UpdatePost($input: UpdatePostInput!) {
            updatePost(input: $input) {
                post {
                    id
                    url
                }
            }
        }
        `;
        inputData.id = existingPostId;
        variables = { input: inputData };
    } else {
        console.log(`Creating new Hashnode post: ${article.data.title}`);
        mutation = `
        mutation PublishPost($input: PublishPostInput!) {
            publishPost(input: $input) {
                post {
                    id
                    url
                }
            }
        }
        `;
        variables = { input: inputData };
    }

    try {
        const response = await axios.post("https://gql.hashnode.com", {
            query: mutation,
            variables
        }, { headers });

        if (response.data.errors) {
            console.error(`Hashnode API Errors: ${JSON.stringify(response.data.errors)}`);
        } else {
            const data = response.data.data;
            const postData = data.publishPost || data.updatePost;
            if (postData && postData.post) {
                console.log(`Successfully processed Hashnode post: ${postData.post.url}`);
            } else {
                console.log(`Hashnode response missing post data: ${JSON.stringify(data)}`);
            }
        }
    } catch (error) {
        console.error(`Failed to process Hashnode post: ${error.message}`);
        if (error.response) {
            console.error(error.response.data);
        }
    }
}

async function main() {
    const files = process.argv.slice(2);
    if (files.length === 0) {
        console.log("No files provided");
        return;
    }

    for (const file of files) {
        if (!file.endsWith('.md')) continue;
        
        if (!fs.existsSync(file)) {
            console.log(`File not found: ${file}`);
            continue;
        }

        console.log(`Processing ${file}...`);
        try {
            const fileContent = fs.readFileSync(file, 'utf8');
            const article = matter(fileContent);

            if (article.data.draft === true) {
                console.log(`Skipping draft: ${file}`);
                continue;
            }

            const canonicalUrl = getCanonicalUrl(file);
            const publishDate = article.data.date ? new Date(article.data.date).toISOString() : undefined;
            
            await postToDevto(article, canonicalUrl, publishDate);
            await postToHashnode(article, canonicalUrl, publishDate);

        } catch (error) {
            console.error(`Error processing ${file}: ${error.message}`);
        }
    }
}

main();

