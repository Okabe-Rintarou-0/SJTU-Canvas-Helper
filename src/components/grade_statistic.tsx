import { ReactNode } from "react";
import { GradeStatistic } from "../lib/model"
import ReactEcharts from "echarts-for-react";

export default function GradeStatisticChart({ statistic, subTitleRenderer }: {
    statistic: GradeStatistic,
    subTitleRenderer?: (info: {
        graded: number,
        total: number,
        average: number
    }) => ReactNode
}) {
    const computeGradeDistribution = (grades: number[]) => {
        const gradeMap = new Map<number, number>();
        if (grades.length === 0) {
            return gradeMap;
        }
        const step = 0.5;
        grades.map(grade => {
            let section = grade / step;
            let count = gradeMap.get(section) ?? 0;
            gradeMap.set(section, count + 1);
        });

        return gradeMap;
    }

    const getGradeDistributionOptions = (grades: number[]) => {
        let distribution = computeGradeDistribution(grades);
        let maxSection = 0;
        for (let section of distribution.keys()) {
            if (section > maxSection) {
                maxSection = section;
            }
        }
        let labels = [];
        let values = [];
        const step = 0.5;

        for (let i = 0; i <= maxSection; i++) {
            labels.push(step * i);
            values.push(distribution.get(i) ?? 0);
        }

        return {
            xAxis: {
                data: labels
            },
            yAxis: {},
            legend: {
                data: ['成绩分布']
            },
            series: [
                {
                    name: '成绩分布',
                    type: 'bar',
                    data: values
                }
            ]
        };
    }

    const graded = statistic.grades.length;
    const average = graded > 0 ? statistic.grades.reduce((g1, g2) => g1 + g2) / graded : 0;
    const options = getGradeDistributionOptions(statistic.grades);

    return <>{statistic.total > 0 && <>
        {subTitleRenderer === undefined && <span>
            <b>{graded}/{statistic.total}</b>个提交已记分（平均<b>{average.toFixed(2)}</b>分）</span>}
        {subTitleRenderer !== undefined && subTitleRenderer({ graded, total: statistic.total, average: Number.parseFloat(average.toFixed(2)) })}
    </>}
        {graded > 0 && <ReactEcharts option={options} />}
    </>
}