import { getVertexAccessToken, getVertexCredentialsInfo } from './vertex-auth.js';

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();

    const credsInfo = getVertexCredentialsInfo();

    if (!credsInfo.configured) {
        return res.status(200).json({
            status: "ERROR",
            keyFoundInVercel: false,
            source: credsInfo.source,
            error: credsInfo.error || "No Service Account key found in environment variable GCP_SERVICE_ACCOUNT_KEY.",
            solution: "Paste the full JSON key into Vercel Project Settings -> Environment Variables under the name GCP_SERVICE_ACCOUNT_KEY."
        });
    }

    try {
        const token = await getVertexAccessToken();
        const maskedToken = token ? `${token.substring(0, 6)}...[VALID_OAUTH2_TOKEN]` : "None";

        return res.status(200).json({
            status: "SUCCESS",
            keyFoundInVercel: true,
            source: credsInfo.source,
            serviceAccountEmail: credsInfo.clientEmail,
            projectId: credsInfo.projectId,
            googleOAuth2Handshake: "AUTHENTICATED",
            tokenActive: Boolean(token),
            maskedToken: maskedToken,
            targetCloudProvider: `Google Cloud Vertex AI (${process.env.GCP_LOCATION || 'global'})`,
            message: "🎉 Success! Vercel has successfully fetched your GCP Service Account Key and authenticated with Google Cloud."
        });
    } catch (err) {
        return res.status(200).json({
            status: "TOKEN_EXCHANGE_FAILED",
            keyFoundInVercel: true,
            source: credsInfo.source,
            serviceAccountEmail: credsInfo.clientEmail,
            projectId: credsInfo.projectId,
            googleOAuth2Handshake: "FAILED",
            error: err.message,
            diagnosticTip: err.message.includes("PEM")
                ? "Private key newline formatting issue. Ensure \\n characters are handled."
                : "Check if the Service Account is enabled in GCP Console -> IAM & Admin -> Service Accounts."
        });
    }
}
