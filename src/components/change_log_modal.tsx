import { Modal, Typography } from "antd";
import Paragraph from "antd/es/typography/Paragraph";
import Title from "antd/es/typography/Title";
export function ChangeLogModal({ open, onCancel, onOk }: {
    open: boolean
    onCancel: () => void,
    onOk: () => void,
}) {
    return <Modal title="更新日志" open={open} width={"90%"} footer={null} onCancel={onCancel} onOk={onOk} style={{
        maxHeight: "80%",
        overflow: "scroll",
    }}>
        <Typography>
            <Title level={4}>v1.3.23 2024/12/28</Title>
            <Paragraph>
                <ul>
                    <li>支持 Jupiter Notebook 文件的预览 </li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.22 2024/12/24</Title>
            <Paragraph>
                <ul>
                    <li>新增年度总结板块</li>
                    <li>Merry Xmas!</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.21 2024/11/4</Title>
            <Paragraph>
                <ul>
                    <li>优化作业批改图片显示</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.20 2024/11/4</Title>
            <Paragraph>
                <ul>
                    <li>修复作业提交的路径问题</li>
                    <li>优化部分ui</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.19 2024/10/1</Title>
            <Paragraph>
                <ul>
                    <li>优化日志相关的 UI 和操作（在设置可以打开日志便于排查问题）。目前前端和后端的 log 都会定向到一个日志文件。</li>
                    <li>提升视频下载速度</li>
                    <li>各位国庆快乐🎉🇨🇳</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.18 2024/9/28</Title>
            <Paragraph>
                <ul>
                    <li>新增更详细的操作提示，且提示现在可以关闭（点击不再显示）</li>
                    <li>支持合并视频（需要预先安装好 ffmpeg）</li>
                    <li>支持以 JSON 格式查看配置文件（“设置-显示配置”）</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.17 2024/9/27</Title>
            <Paragraph>
                <ul>
                    <li>恢复 canvas 视频下载功能，支持检查更新（见底部）</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.16 2024/9/27</Title>
            <Paragraph>
                <ul>
                    <li>支持密院 canvas</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.15 2024/9/26</Title>
            <Paragraph>
                <ul>
                    <li>新增人际关系图板块</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.13 2024/8/21</Title>
            <Paragraph>
                <ul>
                    <li>[Enhancement] 优化“作业批改”中选择学生的方式（源自 PR: <a target="_blank" href="https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/pull/33">https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/pull/33</a>）</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.12 2024/6/25</Title>
            <Paragraph>
                <ul>
                    <li>[Enhancement] 支持按 `ctrl`(`command`) + `=` 和 `ctrl`(`command`) + `-` 进行缩放（源自 Issue: <a target="_blank" href="https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/issues/31">https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/issues/31</a>）</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.11 2024/6/18</Title>
            <Paragraph>
                <ul>
                    <li>[Enhancement] 支持调整 PPTX/PDF 合并顺序（源自 Issue: <a target="_blank" href="https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/issues/29">https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/issues/29</a>）</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.10 2024/6/12</Title>
            <Paragraph>
                <ul>
                    <li>[Enhancement] 支持所有课程的视频播放下载</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.8, v1.3.9 2024/6/11</Title>
            <Paragraph>
                <ul>
                    <li>[Fix] 修复视屏播放重名课程导致的 UI bug。 </li>
                    <li>[Enhancement] 增加作业板块均分/最高分/最低分的显示。</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.7 2024/5/26</Title>
            <Paragraph>
                <ul>
                    <li>[Enhancement] 支持显示评论附件。 </li>
                    <li>[Enhancement] 在使用评分册时，水平滚动的时候学生名字将始终显示在屏幕左侧。</li>
                    <li>[Enhancement] 在“文件”页面，点击进入目录时会自动滚动到页面顶部。</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.6 2024/5/20</Title>
            <Paragraph>
                <ul>
                    <li>[Feature] 支持查看<a href="https://oc.sjtu.edu.cn/files" target="_blank">我的文件</a>。</li>
                    <li>祝各位 520 快乐🎉，早日找到另一半～</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.5 2024/5/16</Title>
            <Paragraph>
                <ul>
                    <li>[Fix] 修复老师无法正常使用批改作业功能的 bug。</li>
                    <li>[Fix] 修复课程无老师时无法正确显示的 bug。</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.4 2024/5/15</Title>
            <Paragraph>
                <ul>
                    <li>[Feature] 新增成绩册页面，支持多种视图、导出成绩为 excel 表格。</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.3 2024/5/11</Title>
            <Paragraph>
                <ul>
                    <li>[Feature] 可以给课程的作业绑定（支持多个）文件，便于预览作业要求。</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.2 2024/5/10</Title>
            <Paragraph>
                <ul>
                    <li>[Fix] 修复了主副屏播放速度不同步的问题。即修改主屏幕播放速度，副屏的播放速度没有被同步修改。</li>
                    <li>[Feature] 新增 CHANGE LOG 板块，便于用户查看更新内容。</li>
                </ul>
            </Paragraph>
        </Typography>
    </Modal >
}