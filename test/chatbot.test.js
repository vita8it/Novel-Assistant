const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const { ChannelIds } = require("../backend/Chanel");
const {
    buildAnswerRules,
    buildEmbed,
    extractUrls,
    handleMessage,
    requestAnswer,
    validateAiResult,
} = require("../backend/Chatbot");

const rules = [
    "Scripts: https://discord.com/channels/1550719518865760338/1553079048874500196",
    "Key purchase is in the Discord channel.",
].join("\n");

test("channel configuration maps all supported languages", () => {
    assert.deepEqual(ChannelIds, {
        "1553082280858095666": "TH-TH",
        "1553082897554997258": "EN-EN",
        "1555798277100933140": "BR-BR",
        "1555798685235941437": "VN-VN",
    });
});

test("NO_RESPONSE results never become user-facing answers", () => {
    assert.deepEqual(
        validateAiResult(
            { action: "NO_RESPONSE", title: "", description: "", evidence: [] },
            rules,
        ),
        { action: "NO_RESPONSE" },
    );
    assert.equal(
        buildEmbed({ action: "NO_RESPONSE", title: "", description: "" }),
        null,
    );
});

test("answer context excludes unsupported-question fallback templates", async () => {
    const rulesDocument = (await fs.readFile(
        require("node:path").join(__dirname, "..", "backend", "Rules.md"),
        "utf8",
    )).replace(/\r\n/g, "\n");
    const answerRules = buildAnswerRules(rulesDocument);

    assert.match(answerRules, /## 2\. Script Access/);
    assert.match(answerRules, /## 3\. Key Purchase/);
    assert.match(answerRules, /## 4\. Redeem Key/);
    assert.doesNotMatch(answerRules, /## 5\. Unknown Questions/);
    assert.doesNotMatch(answerRules, /## 6\. Response Priority/);
    assert.doesNotMatch(answerRules, /ไม่พบข้อมูลที่เกี่ยวข้อง/);
});

test("answers require exact evidence from the rules", () => {
    const valid = {
        action: "ANSWER",
        title: "Get scripts",
        description:
            "Use this channel: https://discord.com/channels/1550719518865760338/1553079048874500196",
        evidence: [
            "Scripts: https://discord.com/channels/1550719518865760338/1553079048874500196",
        ],
    };
    assert.equal(validateAiResult(valid, rules).action, "ANSWER");
    assert.equal(
        validateAiResult({ ...valid, evidence: ["invented evidence"] }, rules),
        null,
    );
});

test("answers cannot introduce URLs absent from the rules", () => {
    const answer = {
        action: "ANSWER",
        title: "Get scripts",
        description: "Visit https://example.com",
        evidence: ["Scripts: https://discord.com/channels/1550719518865760338/1553079048874500196"],
    };
    assert.equal(validateAiResult(answer, rules), null);
});

test("Groq uses the lowest-cost multilingual model and strict JSON schema", async () => {
    const originalApiKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "test-key";
    const answer = {
        action: "ANSWER",
        title: "Supported",
        description: "Supported answer",
        evidence: ["Key purchase is in the Discord channel."],
    };
    let request;
    const aiClient = {
        chat: {
            completions: {
                create: async (options) => {
                request = options;
                return {
                    choices: [{
                        finish_reason: "stop",
                        message: { content: JSON.stringify(answer) },
                    }],
                };
            },
            },
        },
    };

    try {
        assert.deepEqual(
            await requestAnswer(
                "Where can I purchase a key?",
                "EN-EN",
                rules,
                aiClient,
            ),
            {
                action: "ANSWER",
                title: "Supported",
                description: "Supported answer",
            },
        );
        assert.equal(request.model, "openai/gpt-oss-20b");
        assert.equal(request.messages[1].content, "Where can I purchase a key?");
        assert.equal(request.response_format.type, "json_schema");
        assert.equal(request.response_format.json_schema.strict, true);
        assert.equal(
            request.response_format.json_schema.schema.additionalProperties,
            false,
        );
        assert.equal(request.max_tokens, 2048);
        assert.match(
            request.messages[0].content,
            /Every user-facing word in title and description MUST be in English/,
        );
    } finally {
        if (originalApiKey === undefined) {
            delete process.env.GROQ_API_KEY;
        } else {
            process.env.GROQ_API_KEY = originalApiKey;
        }
    }
});

test("answer content respects Discord embed size limits", () => {
    const valid = {
        action: "ANSWER",
        title: "Get scripts",
        description: "Supported answer",
        evidence: ["Key purchase is in the Discord channel."],
    };
    assert.equal(
        validateAiResult({ ...valid, title: "x".repeat(257) }, rules),
        null,
    );
    assert.equal(buildEmbed(valid).data.title, "Get scripts");
});

test("URL extraction preserves source URLs without sentence punctuation", () => {
    assert.deepEqual(
        extractUrls("See https://example.com/path."),
        ["https://example.com/path"],
    );
});

test("unsupported channels do not invoke Groq or send a message", async () => {
    let sendCalls = 0;

    await handleMessage({
            id: "unsupported-channel",
            channelId: "not-configured",
            content: "A question",
            author: { bot: false },
            inGuild: () => true,
            channel: { send: async () => { sendCalls += 1; } },
            reply: async () => { sendCalls += 1; },
        }, {
            chat: {
                completions: {
                    create: async () => {
                        throw new Error("Groq must not be called");
                    },
                },
            },
        });

    assert.equal(sendCalls, 0);
});

test("NO_RESPONSE from Groq remains silent; answers reply with an embed", async () => {
    const originalApiKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "test-key";
    let sentPayload;
    let requestBody;
    const exactEvidence = (await fs.readFile(
        require("node:path").join(__dirname, "..", "backend", "Rules.md"),
        "utf8",
    )).replace(/\r\n/g, "\n").split("\n")[2];
    let providerResult = {
        action: "NO_RESPONSE",
        title: "",
        description: "",
        evidence: [],
    };
    const aiClient = {
        chat: {
            completions: {
                create: async (options) => {
                requestBody = options;
                return {
                    choices: [{
                        finish_reason: "stop",
                        message: { content: JSON.stringify(providerResult) },
                    }],
                };
            },
            },
        },
    };

    const message = {
        id: "supported-channel-test",
        channelId: "1553082897554997258",
        content: "Question asked in a different language",
        author: { bot: false },
        inGuild: () => true,
        channel: {
            send: async () => {
                assert.fail("Answers must reply to the original message");
            },
        },
        reply: async (payload) => {
            sentPayload = payload;
        },
    };

    try {
        await handleMessage(message, aiClient);
        assert.equal(sentPayload, undefined);
        assert.match(
            requestBody.messages[0].content,
            /Every user-facing word in title and description MUST be in English/,
        );
        assert.equal(requestBody.model, "openai/gpt-oss-20b");
        assert.equal(requestBody.max_tokens, 2048);

        providerResult = {
            action: "ANSWER",
            title: "Answer",
            description: "Supported response",
            evidence: [exactEvidence],
        };
        message.id = "answer-channel-test";
        await handleMessage(message, aiClient);
        assert.deepEqual(Object.keys(sentPayload), ["embeds", "allowedMentions"]);
        assert.equal(sentPayload.embeds.length, 1);
        assert.equal(sentPayload.embeds[0].data.title, "Answer");
        assert.deepEqual(sentPayload.allowedMentions, { repliedUser: false });
    } finally {
        if (originalApiKey === undefined) {
            delete process.env.GROQ_API_KEY;
        } else {
            process.env.GROQ_API_KEY = originalApiKey;
        }
    }
});
