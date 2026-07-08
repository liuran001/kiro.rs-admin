//! Kiro Runtime CLI 端点（CLI 协议 / runtime 限流桶）
//!
//! 把 [`super::cli::CliEndpoint`] 的 **CLI 协议**（KIRO_CLI origin、aws-sdk-rust UA、
//! `x-amz-json-1.0`、x-amz-target）搬到独立限流桶 `runtime.kiro.dev` 上：
//! - URL: `https://runtime.{api_region}.kiro.dev/`（根路径 + x-amz-target 头）
//! - Content-Type: `application/x-amz-json-1.0`
//! - 请求体 origin: `KIRO_CLI`
//!
//! 作用：`cli`（q 桶）429 时的**同协议**降级目标——换桶不换号、也不换协议身份，
//! 修复此前 cli 降级到 IDE 协议 runtime 导致凭据身份被悄悄改写的问题。
//!
//! ⚠️ 未验证：`runtime.kiro.dev` 是否接受 CLI（x-amz-json-1.0 + x-amz-target）协议。
//! 若上游拒绝，则本端点在降级链中会失败并落回换凭据/退避逻辑（安全兜底）。

use reqwest::RequestBuilder;
use uuid::Uuid;

use super::cli::set_origin_kiro_cli;
use super::{KiroEndpoint, RequestContext};

/// Kiro Runtime CLI 端点名称
pub const RUNTIME_CLI_ENDPOINT_NAME: &str = "runtime_cli";

/// Kiro Runtime CLI 端点
pub struct RuntimeCliEndpoint;

impl RuntimeCliEndpoint {
    pub fn new() -> Self {
        Self
    }

    fn api_region<'a>(&self, ctx: &'a RequestContext<'_>) -> &'a str {
        ctx.credentials.effective_api_region(ctx.config)
    }

    fn host(&self, ctx: &RequestContext<'_>) -> String {
        format!("runtime.{}.kiro.dev", self.api_region(ctx))
    }

    fn user_agent(&self, ctx: &RequestContext<'_>) -> String {
        format!(
            "aws-sdk-rust/1.3.15 ua/2.1 api/codewhispererstreaming/0.1.14474 os/{} lang/rust/1.92.0 md/appVersion-{} app/AmazonQ-For-CLI",
            ctx.config.system_version,
            ctx.config.kiro_version,
        )
    }

    fn x_amz_user_agent(&self, ctx: &RequestContext<'_>) -> String {
        format!(
            "aws-sdk-rust/1.3.15 ua/2.1 api/codewhispererstreaming/0.1.14474 os/{} lang/rust/1.92.0 m/F app/AmazonQ-For-CLI",
            ctx.config.system_version,
        )
    }
}

impl Default for RuntimeCliEndpoint {
    fn default() -> Self {
        Self::new()
    }
}

impl KiroEndpoint for RuntimeCliEndpoint {
    fn name(&self) -> &'static str {
        RUNTIME_CLI_ENDPOINT_NAME
    }

    /// runtime_cli 走 `runtime.kiro.dev`（CLI 协议）；429 时回切 q 桶的同协议端点 cli。
    fn fallback_chain(&self) -> &'static [&'static str] {
        use crate::kiro::endpoint::cli::CLI_ENDPOINT_NAME;
        &[CLI_ENDPOINT_NAME]
    }

    fn content_type(&self) -> &'static str {
        "application/x-amz-json-1.0"
    }

    fn api_url(&self, ctx: &RequestContext<'_>) -> String {
        format!("https://runtime.{}.kiro.dev/", self.api_region(ctx))
    }

    fn mcp_url(&self, ctx: &RequestContext<'_>) -> String {
        format!("https://runtime.{}.kiro.dev/mcp", self.api_region(ctx))
    }

    fn decorate_api(&self, req: RequestBuilder, ctx: &RequestContext<'_>) -> RequestBuilder {
        let mut req = req
            .header(
                "x-amz-target",
                "AmazonCodeWhispererStreamingService.GenerateAssistantResponse",
            )
            .header("x-amzn-codewhisperer-optout", "false")
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

    fn transform_api_body(&self, body: &str, _ctx: &RequestContext<'_>) -> String {
        set_origin_kiro_cli(body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kiro::model::credentials::KiroCredentials;
    use crate::model::config::Config;

    #[test]
    fn test_runtime_cli_url_and_fallback() {
        let endpoint = RuntimeCliEndpoint::new();
        let mut config = Config::default();
        config.api_region = Some("us-east-1".to_string());
        let creds = KiroCredentials::default();
        let ctx = RequestContext {
            credentials: &creds,
            token: "tok",
            machine_id: "machine",
            config: &config,
        };
        assert_eq!(endpoint.api_url(&ctx), "https://runtime.us-east-1.kiro.dev/");
        assert_eq!(endpoint.content_type(), "application/x-amz-json-1.0");
        // 降级链回切同协议的 cli，绝不跨到 IDE 协议
        assert_eq!(
            endpoint.fallback_chain(),
            &[super::super::cli::CLI_ENDPOINT_NAME]
        );
    }
}
