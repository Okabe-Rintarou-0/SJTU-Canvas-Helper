import { Box } from "@mui/material";
import BasicLayout from "../components/layout";
import RelationshipGraph from "../components/relationship_graph";

export default function RelationshipPage() {
    return <BasicLayout>
        <Box sx={{ width: "100%", overflow: "auto" }}>
            <RelationshipGraph />
        </Box>
    </BasicLayout>
}
