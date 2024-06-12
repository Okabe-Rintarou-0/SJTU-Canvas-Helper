pub const BASE_URL: &str = "https://oc.sjtu.edu.cn";
pub const VIDEO_BASE_URL: &str = "https://courses.sjtu.edu.cn/app";
pub const CANVAS_LOGIN_URL: &str = "https://oc.sjtu.edu.cn/login/openid_connect";
pub const VIDEO_LOGIN_URL: &str =
    "https://courses.sjtu.edu.cn/app/oauth/2.0/login?login_type=outer";
pub const VIDEO_OAUTH_KEY_URL: &str = "https://courses.sjtu.edu.cn/app/vodvideo/vodVideoPlay.d2j?ssoCheckToken=ssoCheckToken&refreshToken=&accessToken=&userId=&";
pub const VIDEO_INFO_URL: &str =
    "https://courses.sjtu.edu.cn/app/system/resource/vodVideo/getvideoinfos";
pub const AUTH_URL: &str = "https://jaccount.sjtu.edu.cn";
pub const MY_SJTU_URL: &str = "https://my.sjtu.edu.cn/ui/appmyinfo";
pub const EXPRESS_LOGIN_URL: &str = "https://jaccount.sjtu.edu.cn/jaccount/expresslogin";
pub const OAUTH_PATH: &str =
    "aHR0cHM6Ly9jb3Vyc2VzLnNqdHUuZWR1LmNuL2FwcC92b2R2aWRlby92b2RWaWRlb1BsYXkuZDJq";
pub const OAUTH_RANDOM: &str = "oauth_ABCDE=ABCDEFGH&oauth_VWXYZ=STUVWXYZ";
pub const OAUTH_RANDOM_P1: &str = "oauth_ABCDE";
pub const OAUTH_RANDOM_P2: &str = "oauth_VWXYZ";
pub const OAUTH_RANDOM_P1_VAL: &str = "ABCDEFGH";
pub const OAUTH_RANDOM_P2_VAL: &str = "STUVWXYZ";
pub const CHUNK_SIZE: u64 = 16 * 1024 * 1024;
pub const VIDEO_CHUNK_SIZE: u64 = 4 * 1024 * 1024;

pub const JBOX_LOGIN_URL: &str =
    "https://pan.sjtu.edu.cn/user/v1/sign-in/sso-login-redirect/xpw8ou8y";
pub const JBOX_LOGIN_URL2: &str = "https://pan.sjtu.edu.cn/user/v1/sign-in/verify-account-login/xpw8ou8y?device_id=Chrome+116.0.0.0&type=sso&credential=";
pub const JBOX_USER_SPACE_URL: &str = "https://pan.sjtu.edu.cn/user/v1/space/1/personal";
pub const JBOX_BASE_URL: &str = "https://pan.sjtu.edu.cn";
// 4M
pub const JBOX_UPLOAD_CHUNK_SIZE: usize = 4 * 1024 * 1024;
