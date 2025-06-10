import { InputNumber, Space, Spin, Typography } from "antd";
import Title from "antd/lib/typography/Title";
import ReactEcharts from "echarts-for-react";
import { useState } from "react";
import BasicLayout from "../components/layout";
import { useAnnualReport } from "../lib/hooks";
import { AnnualReport } from "../lib/model";
// import ReactJson from "react-json-view-ts";

interface BarChartProps {
    data: Map<string, number[]>;
    xAxisData: string[]
}

const BarChart: React.FC<BarChartProps> = ({ data, xAxisData }) => {
    const option: echarts.EChartsOption = {
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'cross'
            },
            formatter: function (params: any) {
                let tooltipStr = '';
                for (const param of params) {
                    if (param.value !== 0) {
                        tooltipStr += `${param.marker}${param.seriesName}: ${param.value}<br>`;
                    }
                };
                return tooltipStr || '暂无数据';
            }
        },
        xAxis: {
            type: 'category',
            data: xAxisData,
            boundaryGap: true
        },
        alignWithLabel: true,
        yAxis: {
            type: 'value'
        },
        series: []
    };

    data.forEach((data, name) => {
        (option.series as any[]).push({
            name,
            type: 'bar',
            stack: 'x',
            data
        });
    });

    return (
        <div style={{ width: '100%' }}>
            <ReactEcharts option={option} />
        </div>
    );
};

export default function AnnualPage() {
    const [currentYear, setCurrentYear] = useState<number>((new Date()).getFullYear());
    const [selectedYear, setSelectedYear] = useState<number>((new Date()).getFullYear());
    const report = useAnnualReport(selectedYear);

    function isDaytime(timeStr: string): boolean {
        const date = new Date(timeStr);
        const hours = date.getHours();
        return hours >= 6 && hours < 18;
    }

    function countDayAndNightSubmits(annualReport: AnnualReport): [number, number] {
        let dayCount = 0;
        let nightCount = 0;
        for (let courseId in annualReport.courseToStatistic) {
            let courseStatistic = annualReport.courseToStatistic[courseId];

            courseStatistic.submitTimeList.forEach((timeStr) => {
                if (isDaytime(timeStr)) {
                    dayCount++;
                } else {
                    nightCount++;
                }
            });
        };
        return [dayCount, nightCount];
    }

    function getHour(timeStr: string): number {
        const date = new Date(timeStr);
        return date.getHours();
    }


    function getMonth(timeStr: string) {
        const date = new Date(timeStr);
        return date.getMonth();
    }

    function countSubmitsByMonth(annualReport?: AnnualReport): [Map<string, number[]>, number] {
        const result: Map<string, number[]> = new Map();
        if (!annualReport) {
            return [result, 1];
        }
        let maxMonth = 1;
        let maxMonthCount = 0;
        let totalMonthArray = new Array(12).fill(0);
        for (let courseId in annualReport.courseToStatistic) {
            let courseStatistic = annualReport.courseToStatistic[courseId]; {
                const monthCountArray: number[] = new Array(12).fill(0);
                courseStatistic.submitTimeList.forEach((timeStr) => {
                    const month = getMonth(timeStr);
                    monthCountArray[month]++;
                    totalMonthArray[month]++;
                    if (totalMonthArray[month] > maxMonthCount) {
                        maxMonth = month + 1;
                        maxMonthCount = totalMonthArray[month];
                    }
                });
                result.set(courseStatistic.courseName, monthCountArray);
            };
        }
        return [result, maxMonth];
    }

    function countSubmitsByHour(annualReport?: AnnualReport): Map<string, number[]> {
        const result: Map<string, number[]> = new Map();
        if (!annualReport) {
            return result;
        }
        for (let courseId in annualReport.courseToStatistic) {
            let courseStatistic = annualReport.courseToStatistic[courseId]; {
                const hourCountArray: number[] = new Array(24).fill(0);
                courseStatistic.submitTimeList.forEach((timeStr) => {
                    const hour = getHour(timeStr);
                    hourCountArray[hour]++;
                });
                result.set(courseStatistic.courseName, hourCountArray);
            };
        }
        return result;
    }

    const [dayCount, nightCount] = report.data ? countDayAndNightSubmits(report.data) : [0, 0];
    const hourCountMap = countSubmitsByHour(report.data);
    const [monthCountMap, maxMonth] = countSubmitsByMonth(report.data);

    return <BasicLayout>
        <Space direction="vertical" style={{ width: "100%", overflow: "scroll" }}>
            <Space>
                请输入年份（按下回车完成输入）：
                <InputNumber defaultValue={currentYear} min={0} onChange={(v) => setCurrentYear(v ?? 0)} onPressEnter={() => setSelectedYear(currentYear)} />
            </Space>
            <Spin tip="正在加载中..." spinning={report.isLoading}>
                {report.data && <Typography>
                    <Title level={2}>
                        {selectedYear}年年度总结
                    </Title>
                    <div>
                        在过去的一年里，你有{dayCount}次在白天提交作业，{nightCount}次在晚上提交作业，
                        {dayCount > nightCount && "看来你更喜欢在白天出没。"}
                        {nightCount > dayCount && "或许你是妥妥的夜猫子？"}
                        {nightCount === dayCount && "看来你是折衷主义者。"}
                    </div>
                    <BarChart data={hourCountMap} xAxisData={Array.from({ length: 24 }, (_, i) => `${i}:00`)} />
                    <div>
                        你最忙碌的月份是{maxMonth}月，你倾注的汗水一定有所回报。
                    </div>
                    <BarChart data={monthCountMap} xAxisData={Array.from({ length: 12 }, (_, i) => `${i + 1}月`)} />
                </Typography>}
            </Spin>
            {/* <ReactJson src={report.data ?? {}} collapsed={false} /> */}
        </Space>
    </BasicLayout>
}