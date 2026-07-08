//! Kiro CodeWhisperer 端点（IDE 协议 / 独立限流桶）
//!
//! 对应 demo（kiro-go）中 index 1 的 "CodeWhisperer" 端点：
//! - API: `https://codewhisperer.{api_region}.amazonaws.com/generateAssistantResponse`
//! - X-Amz-Target: `AmazonCodeWhispererStreamingService.GenerateAssistantResponse`
//!
//! 与 [`super::ide::IdeEndpoint`] **同协议**（origin=AI_EDITOR、aws-sdk-js UA、
//! 注入 profileArn、agent-mode=vibe），仅 host 与 x-amz-target 不同。
//! `codewhisperer.amazonaws.com` 是与 `q.amazonaws.com` / `runtime.kiro.dev` 相互
//! 独立的限流桶，作为 IDE 协议 429 降级链中的一个桶（见 [`super::KiroEndpoint::fallback_chain`]）。

use reqwest::RequestBuilder;
use uuid::Uuid;

use super::ide::inject_profile_arn;
use super::{KiroEndpoint, RequestContext};
use crate::kiro::kiro_version;

/// Kiro CodeWhisperer 端点名称
pub const CODEWHISPERER_ENDPOINT_NAME: &str = "codewhisperer";

/// CodeWhisperer 流式服务的 x-amz-target
const CODEWHISPERER_AMZ_TARGET: &str =
    "AmazonCodeWhispererStreamingService.GenerateAssistantResponse";

/// Kiro CodeWhisperer 端点
pub struct CodeWhispererEndpoint;

impl CodeWhispererEndpoint {
    pub fn new() -> Self {
        Self
    }

    fn api_region<'a>(&self, ctx: &'a RequestContext<'_>) -> &'a str {
        ctx.credentials.effective_api_region(ctx.config)
    }

    fn host(&self, ctx: &RequestContext<'_>) -> String {
        format!("codewhisperer.{}.amazonaws.com", self.api_region(ctx))
    }

    fn x_amz_user_agent(&self, ctx: &RequestContext<'_>) -> String {
        format!(
            "aws-sdk-js/1.0.34 KiroIDE-{}-{}",
            kiro_version::effective(&ctx.config.kiro_version),
            ctx.machine_id
        )
    }

    fn user_agent(&self, ctx: &RequestContext<'_>) -> String {
        format!(
            "aws-sdk-js/1.0.34 ua/2.1 os/{} lang/js md/nodejs#{} api/codewhispererstreaming#1.0.34 m/E KiroIDE-{}-{}",
            ctx.config.system_version,
            ctx.config.node_version,
            kiro_version::effective(&ctx.config.kiro_version),
            ctx.machine_id
        )
    }
}

impl Default for CodeWhispererEndpoint {
    fn default() -> Self {
        Self::new()
    }
}

impl KiroEndpoint for CodeWhispererEndpoint {
    fn name(&self) -> &'static str {
        CODEWHISPERER_ENDPOINT_NAME
    }

    /// codewhisperer 走独立 host；429 时沿 IDE 协议链回切 q 家族与 runtime 桶。
    fn fallback_chain(&self) -> &'static [&'static str] {
        use crate::kiro::endpoint::{
            amazonq::AMAZONQ_ENDPOINT_NAME, ide::IDE_ENDPOINT_NAME, runtime::RUNTIME_ENDPOINT_NAME,
        };
        &[
            RUNTIME_ENDPOINT_NAME,
            IDE_ENDPOINT_NAME,
            AMAZONQ_ENDPOINT_NAME,
        ]
    }

    fn api_url(&self, ctx: &RequestContext<'_>) -> String {
        format!(
            "https://codewhisperer.{}.amazonaws.com/generateAssistantResponse",
            self.api_region(ctx)
        )
    }

    fn mcp_url(&self, ctx: &RequestContext<'_>) -> String {
        format!(
            "https://codewhisperer.{}.amazonaws.com/mcp",
            self.api_region(ctx)
        )
    }

    fn decorate_api(&self, req: RequestBuilder, ctx: &RequestContext<'_>) -> RequestBuilder {
        let mut req = req
            .header("x-amz-target", CODEWHISPERER_AMZ_TARGET)
            .header("x-amzn-codewhisperer-optout", "true")
            .header("x-amzn-kiro-agent-mode", "vibe")
            .header("x-amz-user-agent", self.x_amz_user_agent(ctx))
            .header("user-agent", self.user_agent(ctx))
            .header("host", self.host(ctx))
            .header("amz-sdk-invocation-id", Uuid::new_v4().to_string())
            .header("amz-sdk-request", "attempt=1; max=3")
            .header("Authorization", format!("Bearer {}", ctx.token));

        if ctx.credentials.is_api_key_credential() {
            req = req.header("tokentype", "API_KEY");
        } else if ctx.credentials.is_external_idp() {
            req = req.header("tokentype", "EXTERNAL_IDP");
        }
        req
    }

    fn decorate_mcp(&self, req: RequestBuilder, ctx: &RequestContext<'_>) -> RequestBuilder {
        let mut req = req
            .header("x-amz-user-agent", self.x_amz_user_agent(ctx))
            .header("user-agent", self.user_agent(ctx))
            .header("host", self.host(ctx))
            .header("amz-sdk-invocation-id", Uuid::new_v4().to_string())
            .header("amz-sdk-request", "attempt=1; max=3")
            .header("Authorization", format!("Bearer {}", ctx.token));

        if let Some(arn) = ctx.credentials.effective_profile_arn() {
            req = req.header("x-amzn-kiro-profile-arn", arn);
        }
        if ctx.credentials.is_api_key_credential() {
            req = req.header("tokentype", "API_KEY");
        } else if ctx.credentials.is_external_idp() {
            req = req.header("tokentype", "EXTERNAL_IDP");
        }
        req
    }

    fn transform_api_body(&self, body: &str, ctx: &RequestContext<'_>) -> String {
        inject_profile_arn(body, ctx.credentials.streaming_profile_arn().as_deref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kiro::model::credentials::KiroCredentials;
    use crate::model::config::Config;

    #[test]
    fn test_codewhisperer_url_and_target() {
        let endpoint = CodeWhispererEndpoint::new();
        let mut config = Config::default();
        config.api_region = Some("us-east-1".to_string());
        let creds = KiroCredentials::default();
        let ctx = RequestContext {
            credentials: &creds,
            token: "tok",
            machine_id: "machine",
            config: &config,
        };
        assert_eq!(
            endpoint.api_url(&ctx),
            "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse"
        );
        assert_eq!(endpoint.host(&ctx), "codewhisperer.us-east-1.amazonaws.com");
    }
}
