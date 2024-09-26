import { Space } from "antd";
import BasicLayout from "../components/layout";
import RelationshipGraph from "../components/relationship_graph";

export default function RelationshipPage() {
    return <BasicLayout>
        <Space direction="vertical" style={{ width: "100%", overflow: "scroll" }} size={"large"}>
            <RelationshipGraph />
        </Space>
    </BasicLayout>
}